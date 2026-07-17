// The only file in the story that imports three. Everything here is orchestration around a
// single baked GLB: load it, bake its animation into a flat exploded/assembled pose pair per
// part (discarding the imported hierarchy so the `$AssimpFbx$` pivot chains vanish), then drive
// those poses each frame from the pure EngineFrame the caller computes via beats.ts.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { lerp, ramp } from '../scene';
import { type EngineFrame, HERO_IDLE_RATE, HIGHLIGHT_GREEN, HIGHLIGHT_RED, LINK_AMBER, MOUNT_SCALE } from './beats';
import { FAMILY_MATERIAL, FRONT_DRIVE, FRONT_MOUNT, familyOf, type PartFamily } from './parts';
import engineGlbUrl from '~/assets/engine/engine.glb?url';
import engineAoUrl from '~/assets/engine/engine-ao.webp?url';
import engineNormalUrl from '~/assets/engine/engine-normal.webp?url';
import engineRoughnessUrl from '~/assets/engine/engine-roughness.webp?url';

interface Pose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

interface PartRecord {
  mesh: THREE.Mesh;
  assembled: Pose;
  exploded: Pose;
  family: PartFamily;
  isFrontDrive: boolean;
  isMount: boolean;
  localSphere: THREE.Sphere; // geometry-local, unscaled -- transformed by matrixWorld per frame
}

interface ShellRecord {
  mesh: THREE.Mesh;
  kind: 'green' | 'red' | 'mountGreen';
}

const POSE_EPSILON = 1e-6;

// The baked take is a sequential fly-in: its first frame is off-stage staging, not a designed
// exploded constellation, so raw first-key positions can't be used directly. What the first key
// does carry is the authored assembly axis (staging -> seat). The exploded pose is rebuilt as
// assembled + that direction, with the raw staging distance compressed into a bounded shell so
// every part hangs near the engine with clear space (and the camera fit stays sane).
const EXPLODE_MIN_FRACTION = 0.18;
const EXPLODE_MAX_FRACTION = 0.75;

function capturePose(object: THREE.Object3D): Pose {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  object.matrixWorld.decompose(position, quaternion, scale);
  return { position, quaternion, scale };
}

// Standard two-sphere bounding-sphere merge: grows `target` in place to contain `addition`.
function sphereUnion(target: THREE.Sphere, addition: THREE.Sphere): void {
  if (addition.radius <= 0) return;
  if (target.radius <= 0) {
    target.copy(addition);
    return;
  }
  const distance = target.center.distanceTo(addition.center);
  if (distance + addition.radius <= target.radius) return; // addition fully inside target
  if (distance + target.radius <= addition.radius) {
    target.copy(addition);
    return;
  }
  const newRadius = (target.radius + addition.radius + distance) / 2;
  target.center.lerp(addition.center, (newRadius - target.radius) / distance);
  target.radius = newRadius;
}

export class EngineScene {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly pmrem: THREE.PMREMGenerator;

  private group: THREE.Group | null = null;
  private parts: PartRecord[] = [];
  private frontDriveParts: PartRecord[] = [];
  private mountPart: PartRecord | null = null;
  private shells: ShellRecord[] = [];
  private links: THREE.Mesh[] = [];
  private modelRadius = 1;

  private currentFrame: EngineFrame | null = null;
  private heroIdle = false;
  private idleAzimuthOffset = 0;
  private idleLastTime = 0;
  private rafId: number | null = null;

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);

    const key = new THREE.DirectionalLight(0xfff4e6, 2.0);
    key.position.set(3, 4, 5);
    this.scene.add(key);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.15));

    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    this.resize();
  }

  async load(): Promise<void> {
    const gltfLoader = new GLTFLoader();
    gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    const textureLoader = new THREE.TextureLoader();

    const [gltf, normalMap, roughnessMap, aoMap] = await Promise.all([
      gltfLoader.loadAsync(engineGlbUrl),
      textureLoader.loadAsync(engineNormalUrl),
      textureLoader.loadAsync(engineRoughnessUrl),
      textureLoader.loadAsync(engineAoUrl)
    ]);

    // Shared detail maps: one UV set (`channel = 0`) carries normal, roughness, and AO alike;
    // linear color space because none of these encode display-referred color.
    for (const map of [normalMap, roughnessMap, aoMap]) {
      map.flipY = false;
      map.colorSpace = THREE.NoColorSpace;
      map.channel = 0;
    }

    const environment = new RoomEnvironment();
    this.scene.environment = this.pmrem.fromScene(environment, 0.04).texture;
    this.scene.background = null;
    environment.dispose();

    const clip = gltf.animations[0];
    if (!clip) throw new Error('EngineScene: engine.glb has no bake animation clip');

    // LoopOnce + clamp: with the default LoopRepeat, setTime(duration) wraps back to frame 0
    // and both samples silently capture the same staging pose.
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();

    gltf.scene.updateMatrixWorld(true);
    mixer.setTime(0);
    gltf.scene.updateMatrixWorld(true);
    const stagingPoses = new Map<string, Pose>();
    gltf.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) stagingPoses.set(object.uuid, capturePose(object));
    });

    mixer.setTime(clip.duration);
    gltf.scene.updateMatrixWorld(true);
    const assembledPoses = new Map<string, Pose>();
    const meshes: THREE.Mesh[] = [];
    gltf.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        assembledPoses.set(object.uuid, capturePose(object));
        meshes.push(object);
      }
    });

    // Model scale reference for the exploded shell: the assembled pose's own bounding sphere.
    const centroid = new THREE.Vector3();
    for (const mesh of meshes) centroid.add(assembledPoses.get(mesh.uuid)?.position ?? new THREE.Vector3());
    if (meshes.length > 0) centroid.divideScalar(meshes.length);
    let modelRadius = 1;
    for (const mesh of meshes) {
      const assembled = assembledPoses.get(mesh.uuid);
      if (assembled) modelRadius = Math.max(modelRadius, assembled.position.distanceTo(centroid));
    }
    this.modelRadius = modelRadius;

    // Exploded pose per part: assembled position pushed along the authored assembly axis
    // (staging -> seat, reversed), raw staging distance compressed into
    // [EXPLODE_MIN..EXPLODE_MAX] of the model radius. Orientation and scale stay assembled —
    // a technical exploded view translates parts, it doesn't tumble them. Parts the take never
    // moves separate radially from the centroid instead.
    const explodedPoses = new Map<string, Pose>();
    for (const mesh of meshes) {
      const assembled = assembledPoses.get(mesh.uuid);
      const staging = stagingPoses.get(mesh.uuid);
      if (!assembled || !staging) continue;

      const direction = staging.position.clone().sub(assembled.position);
      const rawDistance = direction.length();
      if (rawDistance * rawDistance < POSE_EPSILON) {
        direction.copy(assembled.position).sub(centroid);
        if (direction.lengthSq() < POSE_EPSILON) direction.set(0, 1, 0);
      }
      direction.normalize();

      const saturated = rawDistance / (rawDistance + modelRadius); // 0..1, monotonic in rawDistance
      const distance = modelRadius * lerp(EXPLODE_MIN_FRACTION, EXPLODE_MAX_FRACTION, saturated);
      explodedPoses.set(mesh.uuid, {
        position: assembled.position.clone().addScaledVector(direction, distance),
        quaternion: assembled.quaternion.clone(),
        scale: assembled.scale.clone()
      });
    }

    // Flatten: fresh meshes sharing the original geometries, positioned at their baked
    // assembled world pose, materials assigned by family. The imported gltf.scene (and its
    // `$AssimpFbx$` pivot chain) is discarded from here on.
    const group = new THREE.Group();
    const materials = new Map<PartFamily, THREE.MeshStandardMaterial>();
    const materialFor = (family: PartFamily): THREE.MeshStandardMaterial => {
      const existing = materials.get(family);
      if (existing) return existing;
      const spec = FAMILY_MATERIAL[family];
      const material = new THREE.MeshStandardMaterial({
        color: spec.color,
        roughness: spec.roughness,
        metalness: spec.metalness,
        normalMap,
        roughnessMap,
        aoMap,
        aoMapIntensity: 0.85
      });
      materials.set(family, material);
      return material;
    };

    const frontDriveSet = new Set(FRONT_DRIVE);
    const frontMountSet = new Set(FRONT_MOUNT);
    const parts: PartRecord[] = [];

    for (const mesh of meshes) {
      const assembled = assembledPoses.get(mesh.uuid);
      const exploded = explodedPoses.get(mesh.uuid);
      if (!assembled || !exploded) continue;

      const geometry = mesh.geometry;
      geometry.computeBoundingSphere();
      const localSphere = geometry.boundingSphere?.clone() ?? new THREE.Sphere();

      const family = familyOf(mesh.name);
      const partMesh = new THREE.Mesh(geometry, materialFor(family));
      partMesh.name = mesh.name;
      partMesh.position.copy(assembled.position);
      partMesh.quaternion.copy(assembled.quaternion);
      partMesh.scale.copy(assembled.scale);
      group.add(partMesh);

      parts.push({
        mesh: partMesh,
        assembled,
        exploded,
        family,
        isFrontDrive: frontDriveSet.has(mesh.name),
        isMount: frontMountSet.has(mesh.name),
        localSphere
      });
    }

    // Recenter so the assembled bounding-sphere center sits at the world origin; camera-fit
    // math and the never-cropped rule both assume the rig's resting pose is centered.
    const assembledSphere = new THREE.Box3().setFromObject(group).getBoundingSphere(new THREE.Sphere());
    group.position.copy(assembledSphere.center).negate();

    this.parts = parts;
    this.frontDriveParts = parts.filter((part) => part.isFrontDrive);
    this.mountPart = parts.find((part) => part.isMount) ?? null;

    this.group = group;
    this.scene.add(group);

    this.buildHighlightShells();
    this.buildLinkageLines();

    this.resize();
  }

  setFrame(frame: EngineFrame): void {
    this.currentFrame = frame;
    if (!this.group || !this.mountPart) return;

    this.updatePartTransforms(frame);
    this.group.updateMatrixWorld(true);
    this.updateHighlights(frame);
    this.updateLinkage(frame);
    this.fitCameraToFrame(frame);
    this.render();
  }

  setHeroIdle(on: boolean): void {
    if (on === this.heroIdle) return;
    this.heroIdle = on;
    if (on) {
      this.idleLastTime = 0;
      this.rafId = requestAnimationFrame(this.idleTick);
    } else if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  resize(): void {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(Math.max(1, dpr));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.currentFrame) this.fitCameraToFrame(this.currentFrame);
    this.render();
  }

  dispose(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.renderer.domElement.remove();
    this.renderer.dispose();
    this.pmrem.dispose();
  }

  // --- internals -----------------------------------------------------------------------

  private readonly idleTick = (time: number): void => {
    if (!this.heroIdle) {
      this.rafId = null;
      return;
    }
    const dt = this.idleLastTime ? (time - this.idleLastTime) / 1000 : 0;
    this.idleLastTime = time;
    this.idleAzimuthOffset += HERO_IDLE_RATE * dt;
    if (this.currentFrame) this.fitCameraToFrame(this.currentFrame);
    this.render();
    this.rafId = requestAnimationFrame(this.idleTick);
  };

  private updatePartTransforms(frame: EngineFrame): void {
    const mount = this.mountPart;
    if (!mount) return;
    const mountAssembledCenter = mount.assembled.position;
    // Success-only: front-drive assembled targets remap radially about the mount's assembled
    // center as the mount grows, so the resized parts seat onto the resized mount rather than
    // their original (pre-resize) assembled anchors.
    const remapScale = lerp(1, MOUNT_SCALE, frame.seatAdjust);

    for (const part of this.parts) {
      const k = part.isFrontDrive ? frame.frontDriveExplode : frame.explode;
      const assembledPos = part.isFrontDrive
        ? mountAssembledCenter
            .clone()
            .add(part.assembled.position.clone().sub(mountAssembledCenter).multiplyScalar(remapScale))
        : part.assembled.position;

      const basePos = assembledPos.clone().lerp(part.exploded.position, k);
      const baseQuat = part.assembled.quaternion.clone().slerp(part.exploded.quaternion, k);
      const baseScale = part.assembled.scale.clone().lerp(part.exploded.scale, k);

      const scaleFactor = part.isFrontDrive ? frame.frontDriveScale : part.isMount ? frame.mountScale : 1;
      const finalScale = baseScale.clone().multiplyScalar(scaleFactor);

      if (scaleFactor !== 1) {
        // Scale is always applied about the mesh's local origin; FBX pivots rarely sit at the
        // part's geometric center, so compensate position for every resized part (mount and
        // front drive alike) — the resize must read as growth about the part's own center,
        // not as a translation.
        const center = part.localSphere.center;
        const centerScaled = new THREE.Vector3(center.x * baseScale.x, center.y * baseScale.y, center.z * baseScale.z);
        const offset = centerScaled.multiplyScalar(1 - scaleFactor).applyQuaternion(baseQuat);
        part.mesh.position.copy(basePos).add(offset);
      } else {
        part.mesh.position.copy(basePos);
      }
      part.mesh.quaternion.copy(baseQuat);
      part.mesh.scale.copy(finalScale);
    }
  }

  private buildHighlightShells(): void {
    // `xray` shells ignore the depth buffer: the mount sits buried in the assembly at the
    // failure/span/related beats, and its semantic red/green must read through the parts in
    // front — the highlight is a technical overlay, not a repaint.
    const shellMaterial = (color: string, xray: boolean): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: !xray,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
      });

    const shells: ShellRecord[] = [];
    for (const part of this.frontDriveParts) {
      const shell = new THREE.Mesh(part.mesh.geometry, shellMaterial(HIGHLIGHT_GREEN, false));
      shell.scale.setScalar(1.02);
      shell.visible = false;
      part.mesh.add(shell);
      shells.push({ mesh: shell, kind: 'green' });
    }
    if (this.mountPart) {
      const red = new THREE.Mesh(this.mountPart.mesh.geometry, shellMaterial(HIGHLIGHT_RED, true));
      red.scale.setScalar(1.02);
      red.visible = false;
      red.renderOrder = 9;
      this.mountPart.mesh.add(red);
      shells.push({ mesh: red, kind: 'red' });

      const green = new THREE.Mesh(this.mountPart.mesh.geometry, shellMaterial(HIGHLIGHT_GREEN, true));
      green.scale.setScalar(1.02);
      green.visible = false;
      green.renderOrder = 9;
      this.mountPart.mesh.add(green);
      shells.push({ mesh: green, kind: 'mountGreen' });
    }
    this.shells = shells;
  }

  // The linkage is drawn with thin unlit cylinders, not THREE.Line — LineBasicMaterial is a
  // fixed single pixel wide, which disappears against the pale background at page scale.
  private buildLinkageLines(): void {
    const geometry = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    const links: THREE.Mesh[] = [];
    for (let i = 0; i < this.frontDriveParts.length; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: LINK_AMBER,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false
      });
      const link = new THREE.Mesh(geometry, material);
      link.visible = false;
      link.frustumCulled = false;
      link.renderOrder = 10;
      this.scene.add(link);
      links.push(link);
    }
    this.links = links;
  }

  private updateHighlights(frame: EngineFrame): void {
    for (const shell of this.shells) {
      const intensity = shell.kind === 'green' ? frame.green : shell.kind === 'red' ? frame.red : frame.mountGreen;
      const opacity = intensity * (shell.kind === 'red' ? 0.55 : 0.45);
      const material = shell.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = opacity;
      shell.mesh.visible = opacity >= 0.01;
    }
  }

  private updateLinkage(frame: EngineFrame): void {
    const mount = this.mountPart;
    if (!mount) return;
    const mountCenter = mount.mesh.localToWorld(mount.localSphere.center.clone());
    const total = this.frontDriveParts.length;
    const linkRadius = this.modelRadius * 0.008;
    const up = new THREE.Vector3(0, 1, 0);

    this.frontDriveParts.forEach((part, index) => {
      const link = this.links[index];
      if (!link) return;
      // Staggered draw-on: link i draws over its own sub-interval of the overall amber ramp.
      const segmentStart = (index / total) * 0.5;
      const progress = ramp(frame.amber, segmentStart, segmentStart + 0.5);

      const start = part.mesh.localToWorld(part.localSphere.center.clone());
      const end = start.clone().lerp(mountCenter, progress);
      const direction = end.clone().sub(start);
      const length = Math.max(direction.length(), 1e-4);

      link.position.copy(start).add(end).multiplyScalar(0.5);
      link.quaternion.setFromUnitVectors(up, direction.normalize());
      link.scale.set(linkRadius, length, linkRadius);

      const material = link.material as THREE.MeshBasicMaterial;
      material.opacity = progress * 0.85;
      link.visible = progress > 0.01;
    });
  }

  private fitCameraToFrame(frame: EngineFrame): void {
    if (this.parts.length === 0) return;

    const sphere = new THREE.Sphere(new THREE.Vector3(), 0);
    const worldSphere = new THREE.Sphere();
    for (const part of this.parts) {
      worldSphere.copy(part.localSphere).applyMatrix4(part.mesh.matrixWorld);
      sphereUnion(sphere, worldSphere);
    }
    const radius = Math.max(sphere.radius, 0.001);

    const fovY = THREE.MathUtils.degToRad(this.camera.fov);
    const fitFov = Math.min(fovY / 2, Math.atan(Math.tan(fovY / 2) * this.camera.aspect));
    const distance = (radius * frame.margin) / Math.sin(fitFov);

    const azimuth = frame.azimuth + this.idleAzimuthOffset * frame.idleWeight;
    const elevation = frame.elevation;
    const x = distance * Math.cos(elevation) * Math.sin(azimuth);
    const y = distance * Math.sin(elevation);
    const z = distance * Math.cos(elevation) * Math.cos(azimuth);

    this.camera.position.set(sphere.center.x + x, sphere.center.y + y, sphere.center.z + z);
    this.camera.near = Math.max(0.01, distance - radius * 2);
    this.camera.far = distance + radius * 4;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(sphere.center);
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
