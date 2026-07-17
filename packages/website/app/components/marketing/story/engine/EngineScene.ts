// The only file in the story that imports three. Everything here is orchestration around a
// single baked GLB: load it, bake its animation into a flat exploded/assembled pose pair per
// part (discarding the imported hierarchy so the `$AssimpFbx$` pivot chains vanish), then drive
// those poses each frame from the pure EngineFrame the caller computes via beats.ts.
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { lerp, ramp } from '../scene';
import {
  type EngineFrame,
  HERO_IDLE_RATE,
  HIGHLIGHT_GREEN,
  HIGHLIGHT_ORANGE,
  HIGHLIGHT_RED,
  LINK_AMBER,
  MOUNT_SCALE
} from './beats';
import {
  EXPLODE_DIRECTION_REFERENCE,
  EXPLODE_OVERRIDES,
  FAMILY_MATERIAL,
  FRONT_DRIVE,
  FRONT_DRIVE_SEAT_ADJUST,
  FRONT_MOUNT,
  familyOf,
  type PartFamily,
  stripDedupSuffix
} from './parts';
import engineGlbUrl from '~/assets/engine/engine.glb?url';
import engineAoUrl from '~/assets/engine/engine-ao.webp?url';
import engineNormalUrl from '~/assets/engine/engine-normal.webp?url';
import engineRoughnessUrl from '~/assets/engine/engine-roughness.webp?url';
import studioHdrUrl from '~/assets/engine/studio_small_08_1k.hdr?url';

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
  // FRONT_DRIVE_SEAT_ADJUST subset -- only `gear` is physically adjacent to FRONT_MOUNT, so only
  // it remaps its seat target onto the resized mount in `updatePartTransforms`; see parts.ts.
  isSeatAdjust: boolean;
  localSphere: THREE.Sphere; // geometry-local, unscaled -- transformed by matrixWorld per frame
}

interface ShellRecord {
  mesh: THREE.Mesh;
  // 'orange'/'coverOrange' are the gear's / engineBackCover's shared pre-highlight pulse
  // (frame.preHighlightOrange) -- two shell instances (one per part) driven by one frame field.
  kind: 'green' | 'red' | 'mountGreen' | 'orange' | 'coverOrange';
}

const POSE_EPSILON = 1e-6;

// The engine sits in its natural baked assembled orientation throughout, including in the hero --
// as it would be mounted in a car (oil pan down). The hero camera looks down the crankshaft axis
// instead (see HERO_AZIMUTH/HERO_ELEVATION in beats.ts), so no part-level reorientation is needed.

// The baked take is a sequential fly-in: its first frame is off-stage staging, not a designed
// exploded constellation, so raw first-key positions can't be used directly. What the first key
// does carry is the authored assembly axis (staging -> seat). The exploded pose is rebuilt as
// assembled + that direction, with the raw staging distance compressed into a bounded shell so
// every part hangs near the engine with clear space (and the camera fit stays sane).
const EXPLODE_MIN_FRACTION = 0.54;
const EXPLODE_MAX_FRACTION = 1.89;

// The gear's "mismatch" lift: frame.frontDriveLift (0..1, beats.ts) is scaled by the gear's own
// bounding-sphere radius so the offset reads proportionally regardless of model scale. Applied
// along world +Y in the natural assembled/exploded pose space every part's position is already
// expressed in -- so it reads as "up off the cover's face" consistently in every phase that shows
// it (hero/early-traverse never show it since frontDriveLift is still 0 there). ~0.18 puts the
// mismatch clearly off-seat without detaching the gear from the assembly.
const FRONT_LIFT_FRACTION = 0.18;
const FRONT_LIFT_AXIS = new THREE.Vector3(0, 1, 0);

// The page's stage background (see EngineStage's containing div and root.tsx) -- the canvas
// itself is transparent (`alpha: true`, clear alpha 0, `scene.background = null`), so fogging to
// this exact color is what lets distant parts blend into the page instead of a mismatched haze.
const STAGE_BACKGROUND = 0xf2efe6;

// Fog near/far are recomputed every frame in `fitCameraToFrame` relative to the fitted camera
// distance and the current bounding-sphere radius (both already vary continuously with explode
// state), so these are fractions of `radius`, not absolute distances. Near stays close to the
// camera so the assembled view (small radius, parts close together) barely fogs; far is well
// past the sphere's rear so even the fully exploded view never fully swallows the rearmost part.
const FOG_NEAR_RADIUS_FRACTION = 0.4;
const FOG_FAR_RADIUS_FRACTION = 0.55;

// --- Interaction: drag-to-orbit -----------------------------------------------------------
// Pointer drag adds transient camera-orbit offsets on top of whatever beats.ts computed for the
// current phase -- these never feed back into choreography state, so releasing the pointer (or
// re-scrubbing the timeline mid-drag) is exactly as reversible as the rest of the scene. Azimuth
// is clamped to a modest arc; elevation is clamped against the *frame's* base elevation so total
// elevation can't flip past the poles.
const DRAG_SENSITIVITY = 0.005; // rad per pointer px
const DRAG_AZIMUTH_LIMIT = 0.9; // rad, offset-only
const DRAG_ELEVATION_TOTAL_LIMIT = 1.2; // rad, frame.elevation + offset stays within this
const DRAG_SNAP_BACK_RATE = 4; // 1/s, exponential ease back to zero after release

// --- Fake contact shadow -------------------------------------------------------------------
// A flat, unlit "blob" shadow under the assembled engine -- not a real shadow map (the scene has
// no shadow-casting light rig), just a soft radial-gradient plane that reads as contact shadow at
// a fraction of the cost. Sized and positioned once at load time from the *assembled* (rest-pose)
// bounding box, never recomputed from live per-frame bounds, so it doesn't jitter or resize as
// parts explode -- it's a fixed prop pinned to the resting pose, faded via frame.groundShadow.
const GROUND_SHADOW_FOOTPRINT_SCALE = 1.6; // plane size relative to the assembled footprint
const GROUND_SHADOW_DROP_FRACTION = 0.08; // fraction of modelRadius the plane sits below the oil pan -- a visible gap, so the engine reads as hovering just above the ground rather than resting on it
const GROUND_SHADOW_TEXTURE_SIZE = 256;

function clampSigned(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

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
  private groundShadow: THREE.Mesh | null = null;
  private modelRadius = 1;

  private currentFrame: EngineFrame | null = null;
  private heroIdle = false;
  private idleAzimuthOffset = 0;

  // Drag-to-orbit: transient offsets layered onto frame.azimuth/elevation in fitCameraToFrame,
  // never weighted by idleWeight (they apply in every phase) and never fed back into beats.ts.
  private isDragging = false;
  private activePointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private dragAzimuthOffset = 0;
  private dragElevationOffset = 0;

  // Single "needsMotion" rAF driver serving idle spin and drag snap-back -- one loop so neither
  // fights the other over frame timing.
  private rafId: number | null = null;
  private motionLastTime = 0;

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    // AgX over Neutral/ACESFilmic: A/B'd via screenshots at t=0 (hero, gray metal end-on) and
    // t=48 (failure, red highlight legibility) -- see EngineScene's wiki doc for the writeup. AgX
    // reads with more filmic contrast on the unlit gray-metal families (castIron/aluminum) without
    // crushing shadow detail on the machined faces; Neutral looked flatter/washed on the same
    // frames. Exposure bumped slightly above AgX's own default to keep the cream page composition
    // light and airy rather than moody, since AgX's contrast curve darkens midtones a touch.
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:pan-y;cursor:grab;';
    container.appendChild(this.renderer.domElement);

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerEnd);
    canvas.addEventListener('pointercancel', this.onPointerEnd);
    canvas.addEventListener('pointerleave', this.onPointerLeave);

    this.scene = new THREE.Scene();
    // Near/far are placeholders here -- fitCameraToFrame recomputes both every frame relative to
    // the fitted camera distance, since the bounding sphere (and therefore the sane fog range)
    // changes continuously with explode state.
    this.scene.fog = new THREE.Fog(STAGE_BACKGROUND, 1, 100);
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
    const rgbeLoader = new RGBELoader();

    const [gltf, normalMap, roughnessMap, aoMap, hdrTexture] = await Promise.all([
      gltfLoader.loadAsync(engineGlbUrl),
      textureLoader.loadAsync(engineNormalUrl),
      textureLoader.loadAsync(engineRoughnessUrl),
      textureLoader.loadAsync(engineAoUrl),
      rgbeLoader.loadAsync(studioHdrUrl)
    ]);

    // Shared detail maps: one UV set (`channel = 0`) carries normal, roughness, and AO alike;
    // linear color space because none of these encode display-referred color.
    for (const map of [normalMap, roughnessMap, aoMap]) {
      map.flipY = false;
      map.colorSpace = THREE.NoColorSpace;
      map.channel = 0;
    }

    // Studio HDRI (Poly Haven, CC0) replaces the earlier procedural RoomEnvironment for real
    // softbox/rim gradients across the machined faces (ring gear, cylinder-head covers) instead
    // of a flat ambient wash. Equirectangular source -> PMREM, same pipeline RoomEnvironment used.
    // scene.background stays null -- the canvas is transparent (alpha:true) over the cream page
    // and must never be painted over by the environment map.
    hdrTexture.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.environment = this.pmrem.fromEquirectangular(hdrTexture).texture;
    this.scene.background = null;
    hdrTexture.dispose();
    // Intensity/rotation tuned against screenshots at t=0 (hero, end-on) and t=12 (exploded): high
    // enough that the softbox gradient is visible on the aluminum/cast-iron faces without blowing
    // out the light parts under AgX; rotated so the HDRI's brightest softbox falls across the
    // three-quarter camera angle instead of directly behind the lens.
    this.scene.environmentIntensity = 1.1;
    this.scene.environmentRotation = new THREE.Euler(0, Math.PI * 0.35, 0);

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

    // Raw staging -> assembled axis and distance per mesh, ahead of the exploded-pose pass below
    // -- kept separate because EXPLODE_OVERRIDES needs the *reference* parts' own raw axes
    // (averaged into `healthyDirection`) before any part's final exploded pose can be computed.
    const rawExplode = new Map<string, { direction: THREE.Vector3; rawDistance: number }>();
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
      rawExplode.set(mesh.uuid, { direction, rawDistance });
    }

    // The averaged explode direction of EXPLODE_DIRECTION_REFERENCE parts (belt, throttleBody) --
    // more robust than hardcoding an axis guess, since it's derived from the same baked take as
    // everything else. Used below in place of an overridden part's own (unreliable) axis.
    const healthyDirection = new THREE.Vector3();
    for (const mesh of meshes) {
      if (!EXPLODE_DIRECTION_REFERENCE.includes(stripDedupSuffix(mesh.name))) continue;
      const raw = rawExplode.get(mesh.uuid);
      if (raw) healthyDirection.add(raw.direction);
    }
    if (healthyDirection.lengthSq() < POSE_EPSILON) healthyDirection.set(0, 0, 1);
    healthyDirection.normalize();

    // Exploded pose per part: assembled position pushed along the authored assembly axis
    // (staging -> seat, reversed), raw staging distance compressed into
    // [EXPLODE_MIN..EXPLODE_MAX] of the model radius. Orientation and scale stay assembled —
    // a technical exploded view translates parts, it doesn't tumble them. Parts the take never
    // moves separate radially from the centroid instead. EXPLODE_OVERRIDES parts (see `gear`)
    // substitute the healthy reference direction and floor the distance, since their own baked
    // axis barely moves them and would otherwise interpenetrate their mount.
    const explodedPoses = new Map<string, Pose>();
    for (const mesh of meshes) {
      const assembled = assembledPoses.get(mesh.uuid);
      const raw = rawExplode.get(mesh.uuid);
      if (!assembled || !raw) continue;

      const override = EXPLODE_OVERRIDES[stripDedupSuffix(mesh.name)];
      const direction = override?.direction === 'reference' ? healthyDirection : raw.direction;

      const saturated = raw.rawDistance / (raw.rawDistance + modelRadius); // 0..1, monotonic in rawDistance
      let distance = modelRadius * lerp(EXPLODE_MIN_FRACTION, EXPLODE_MAX_FRACTION, saturated);
      if (override?.minDistanceFraction !== undefined) {
        distance = Math.max(distance, modelRadius * override.minDistanceFraction);
      }
      if (override?.maxDistanceFraction !== undefined) {
        distance = Math.min(distance, modelRadius * override.maxDistanceFraction);
      }

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

    // Matched post stripDedupSuffix: several of these meshes share their name with a wrapper
    // group node in the source, so the live mesh name carries GLTFLoader's `_<n>` dedup suffix
    // (`belt` -> `belt_1`) even though FRONT_DRIVE/FRONT_MOUNT list the logical, unsuffixed name.
    const frontDriveSet = new Set(FRONT_DRIVE);
    const frontMountSet = new Set(FRONT_MOUNT);
    const seatAdjustSet = new Set(FRONT_DRIVE_SEAT_ADJUST);
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
        isFrontDrive: frontDriveSet.has(stripDedupSuffix(mesh.name)),
        isMount: frontMountSet.has(stripDedupSuffix(mesh.name)),
        isSeatAdjust: seatAdjustSet.has(stripDedupSuffix(mesh.name)),
        localSphere
      });
    }

    // Recenter so the assembled bounding-sphere center sits at the world origin; camera-fit
    // math and the never-cropped rule both assume the rig's resting pose is centered.
    const assembledBox = new THREE.Box3().setFromObject(group);
    const assembledSphere = assembledBox.getBoundingSphere(new THREE.Sphere());
    group.position.copy(assembledSphere.center).negate();

    // Fake contact shadow: sized/positioned once from the *assembled* (rest-pose) bounding box --
    // never recomputed from live per-frame bounds, so it stays a fixed prop under the resting
    // engine rather than tracking the exploded constellation's much larger, shifting footprint.
    // Added as a child of `group` (pre-recenter) so it inherits the same recenter offset as every
    // part.
    this.groundShadow = this.buildGroundShadow(assembledBox);
    group.add(this.groundShadow);

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
    this.applyFrame(frame);
  }

  setHeroIdle(on: boolean): void {
    if (on === this.heroIdle) return;
    this.heroIdle = on;
    if (on) this.ensureMotionLoop();
    // Turning off doesn't force-cancel the shared loop -- if a snap-back is still in flight, the
    // driver keeps running for it and stops itself once everything (including idle, now off) is
    // settled. See motionTick's settled check.
  }

  resize(): void {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(Math.max(1, dpr));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.currentFrame) this.applyFrame(this.currentFrame);
    else this.render();
  }

  dispose(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerEnd);
    canvas.removeEventListener('pointercancel', this.onPointerEnd);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    canvas.remove();
    this.renderer.dispose();
    this.pmrem.dispose();
  }

  // --- internals -----------------------------------------------------------------------

  private applyFrame(frame: EngineFrame): void {
    if (!this.group || !this.mountPart) return;
    this.updatePartTransforms(frame);
    this.group.updateMatrixWorld(true);
    this.updateHighlights(frame);
    this.updateLinkage(frame);
    this.updateGroundShadow(frame);
    this.fitCameraToFrame(frame);
    this.render();
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.isDragging = true;
    this.activePointerId = event.pointerId;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.renderer.domElement.style.cursor = 'grabbing';
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.isDragging || event.pointerId !== this.activePointerId) return;
    const dx = event.clientX - this.lastPointerX;
    const dy = event.clientY - this.lastPointerY;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;

    // No smoothing lag while dragging -- offsets follow the pointer directly; only the snap-back
    // after release is eased (in motionTick). Signs are inverted from the raw pointer delta so the
    // interaction reads as grabbing the engine's surface: dragging left visually rotates the
    // engine clockwise (not the camera orbiting counter-clockwise around it), and drag up/down is
    // likewise inverted from a plain camera-orbit mapping.
    this.dragAzimuthOffset = clampSigned(this.dragAzimuthOffset - dx * DRAG_SENSITIVITY, DRAG_AZIMUTH_LIMIT);

    // Elevation offset is clamped against the *frame's* base elevation so total elevation
    // (frame.elevation + offset) can't cross the pole, not just the offset in isolation.
    const baseElevation = this.currentFrame?.elevation ?? 0;
    const minOffset = -DRAG_ELEVATION_TOTAL_LIMIT - baseElevation;
    const maxOffset = DRAG_ELEVATION_TOTAL_LIMIT - baseElevation;
    const desired = this.dragElevationOffset + dy * DRAG_SENSITIVITY; // drag up -> look up more (inverted)
    this.dragElevationOffset = Math.min(maxOffset, Math.max(minOffset, desired));

    if (this.currentFrame) this.applyFrame(this.currentFrame);
  };

  private readonly onPointerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    this.isDragging = false;
    this.activePointerId = null;
    this.renderer.domElement.style.cursor = 'grab';
    this.ensureMotionLoop(); // drive the snap-back
  };

  // pointerleave fires even under pointer capture on some browsers when the physical pointer
  // (e.g. a touch) lifts off outside the element -- treated the same as pointerup/cancel so a
  // drag never gets stuck "active" with no way to release it.
  private readonly onPointerLeave = (event: PointerEvent): void => {
    if (this.isDragging) this.onPointerEnd(event);
  };

  private ensureMotionLoop(): void {
    if (this.rafId !== null) return;
    this.motionLastTime = 0;
    this.rafId = requestAnimationFrame(this.motionTick);
  }

  // The one rAF driver for every transient (non-choreography) motion: hero idle spin and drag
  // snap-back. Runs while either is active and stops itself once both have settled, rather than
  // each maintaining a competing loop.
  private readonly motionTick = (time: number): void => {
    const dt = this.motionLastTime ? Math.min((time - this.motionLastTime) / 1000, 0.1) : 0;
    this.motionLastTime = time;

    if (this.heroIdle) {
      this.idleAzimuthOffset += HERO_IDLE_RATE * dt;
      // Wrap the unbounded accumulator into (-pi, pi] so traverse's idleWeight fade-out (see
      // beats.ts's idleWeightAt) unwinds at most half a turn instead of potentially several full
      // turns baked up over a long hero hold -- see issue #2 in the tuning pass that added this.
      // Guarded to ONLY wrap while idleWeight is exactly 1 (i.e. still in `hero`, or at `traverse`
      // l=0): a raw-value 2*pi jump is invisible to the blended camera azimuth ONLY at full
      // weight, since +-pi are 2*pi-equivalent camera positions there. Wrapping mid-fade (weight
      // < 1) would show as a visible snap, so it must never happen once the fade has started.
      if (this.currentFrame?.idleWeight === 1) {
        this.idleAzimuthOffset =
          ((((this.idleAzimuthOffset + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
      }
    }

    if (!this.isDragging) {
      const snap = 1 - Math.exp(-dt * DRAG_SNAP_BACK_RATE);
      this.dragAzimuthOffset += (0 - this.dragAzimuthOffset) * snap;
      this.dragElevationOffset += (0 - this.dragElevationOffset) * snap;
      if (Math.abs(this.dragAzimuthOffset) < 1e-4) this.dragAzimuthOffset = 0;
      if (Math.abs(this.dragElevationOffset) < 1e-4) this.dragElevationOffset = 0;
    }

    if (this.currentFrame) this.applyFrame(this.currentFrame);
    else this.render();

    const settled = !this.heroIdle && this.dragAzimuthOffset === 0 && this.dragElevationOffset === 0;
    if (settled) {
      this.rafId = null;
      return;
    }
    this.rafId = requestAnimationFrame(this.motionTick);
  };

  private updatePartTransforms(frame: EngineFrame): void {
    const mount = this.mountPart;
    if (!mount) return;
    const mountAssembledCenter = mount.assembled.position;
    // Success-only: FRONT_DRIVE_SEAT_ADJUST parts' assembled targets remap radially about the
    // mount's assembled center as the mount grows, so they seat onto the resized mount rather
    // than their original (pre-resize) assembled anchor. Scoped to `gear` alone (the only
    // front-drive part physically adjacent to the rear-mounted FRONT_MOUNT) -- see parts.ts's
    // FRONT_DRIVE_SEAT_ADJUST doc comment for why remapping the far-end front-drive parts
    // (belt/sprockets/throttleBody) against a mount ~135 units away would read as nonsense.
    const remapScale = lerp(1, MOUNT_SCALE, frame.seatAdjust);

    // The gear's lift is resolved to world units here (frame.frontDriveLift is a pure 0..1 weight
    // from beats.ts) as a fraction of the gear's own bounding-sphere radius. FRONT_DRIVE is
    // exactly one part now (`gear`), so `frontDriveParts[0]` is unambiguous. Held for the mount's
    // own catch-up below, scaled by `frame.seatAdjust` so the cover only rises to meet the gear
    // once success remaps the gear's seat target onto the resized mount -- before that (span/
    // related), the cover only grows, and the lift-induced gap stays visibly open.
    const liftGear = this.frontDriveParts[0];
    const liftAmount = liftGear ? frame.frontDriveLift * liftGear.localSphere.radius * FRONT_LIFT_FRACTION : 0;

    for (const part of this.parts) {
      const k = part.isFrontDrive ? frame.frontDriveExplode : frame.explode;
      const assembledPos = part.isSeatAdjust
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

      // The mismatch lift: gear rises off its seat (permanent from `change` onward); the mount
      // catches up to meet it only once `seatAdjust` engages in `success`, so the gap the lift
      // opened stays visible through span/related and closes cleanly at the end of success.
      if (part.isFrontDrive) {
        part.mesh.position.addScaledVector(FRONT_LIFT_AXIS, liftAmount);
      } else if (part.isMount) {
        part.mesh.position.addScaledVector(FRONT_LIFT_AXIS, liftAmount * frame.seatAdjust);
      }

      part.mesh.quaternion.copy(baseQuat);
      part.mesh.scale.copy(finalScale);
    }
  }

  private buildHighlightShells(): void {
    // Every highlight shell here is an ordinary depth-tested overlay: both FRONT_DRIVE (green)
    // and FRONT_MOUNT (red/green) parts are externally visible from the canonical camera angles,
    // so there's no need for the depthTest:false "x-ray" treatment an earlier, buried mount
    // (`engineBlockFront`) required to read through the parts in front of it.
    const shellMaterial = (color: string): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: true,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        fog: false // unlit story UI, not part of the physical scene -- must not veil with depth
      });

    const shells: ShellRecord[] = [];
    for (const part of this.frontDriveParts) {
      const shell = new THREE.Mesh(part.mesh.geometry, shellMaterial(HIGHLIGHT_GREEN));
      shell.scale.setScalar(1.02);
      shell.visible = false;
      part.mesh.add(shell);
      shells.push({ mesh: shell, kind: 'green' });

      // Slightly larger than the green shell so the two don't z-fight when both are near-zero
      // opacity at once (they're never both fully on -- orange precedes green by ~13 t units --
      // but both fade through low opacity during the changeover).
      const orange = new THREE.Mesh(part.mesh.geometry, shellMaterial(HIGHLIGHT_ORANGE));
      orange.scale.setScalar(1.03);
      orange.visible = false;
      part.mesh.add(orange);
      shells.push({ mesh: orange, kind: 'orange' });
    }
    if (this.mountPart) {
      // Slightly larger shell scale than the front-drive parts': FRONT_MOUNT (engineBackCover) is
      // a thin flat plate seen edge-on from some camera angles, so its shell needs a touch more
      // clearance than a rounder part to read clearly at `failure`/`related`.
      const red = new THREE.Mesh(this.mountPart.mesh.geometry, shellMaterial(HIGHLIGHT_RED));
      red.scale.setScalar(1.04);
      red.visible = false;
      this.mountPart.mesh.add(red);
      shells.push({ mesh: red, kind: 'red' });

      const green = new THREE.Mesh(this.mountPart.mesh.geometry, shellMaterial(HIGHLIGHT_GREEN));
      green.scale.setScalar(1.04);
      green.visible = false;
      this.mountPart.mesh.add(green);
      shells.push({ mesh: green, kind: 'mountGreen' });

      const orange = new THREE.Mesh(this.mountPart.mesh.geometry, shellMaterial(HIGHLIGHT_ORANGE));
      orange.scale.setScalar(1.05);
      orange.visible = false;
      this.mountPart.mesh.add(orange);
      shells.push({ mesh: orange, kind: 'coverOrange' });
    }
    this.shells = shells;
  }

  // A soft radial-gradient canvas texture: dark, semi-opaque at center, fading fully transparent
  // at the edge. Cheap stand-in for a real contact shadow (the scene has no shadow-casting light
  // rig to bake one from).
  private buildGroundShadowTexture(): THREE.CanvasTexture {
    const size = GROUND_SHADOW_TEXTURE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const center = size / 2;
      const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
      gradient.addColorStop(0, 'rgba(0,0,0,0.2)');
      gradient.addColorStop(0.6, 'rgba(0,0,0,0.1)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace; // grayscale alpha mask, not display-referred color
    return texture;
  }

  // Flat, horizontal blob shadow just below the assembled engine's lowest point -- sized ~1.6x the
  // assembled footprint (in the box's larger of X/Z extent) so it reads as a grounded contact
  // shadow rather than a tight silhouette outline. `box` is the assembled (rest-pose) bounding box
  // computed once at load time, pre-recenter, in the same space the returned mesh is later added
  // to `group` in -- so its position needs no further adjustment for the recenter translation.
  private buildGroundShadow(box: THREE.Box3): THREE.Mesh {
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    const footprint = Math.max(size.x, size.z);
    const planeSize = footprint * GROUND_SHADOW_FOOTPRINT_SCALE;
    const drop = this.modelRadius * GROUND_SHADOW_DROP_FRACTION;

    const geometry = new THREE.PlaneGeometry(planeSize, planeSize);
    const material = new THREE.MeshBasicMaterial({
      map: this.buildGroundShadowTexture(),
      transparent: true,
      opacity: 1,
      depthWrite: false,
      fog: false // unlit story UI standing in for a shadow, not part of the physical scene
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(center.x, box.min.y - drop, center.z);
    mesh.visible = false;
    mesh.renderOrder = -1; // draw before the opaque parts so it never fights the oil pan's depth
    return mesh;
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
        depthTest: false,
        fog: false // unlit story UI, not part of the physical scene -- must not veil with depth
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
      const intensity =
        shell.kind === 'green'
          ? frame.green
          : shell.kind === 'red'
            ? frame.red
            : shell.kind === 'mountGreen'
              ? frame.mountGreen
              : frame.preHighlightOrange; // 'orange' | 'coverOrange' -- one shared weight, two parts
      const opacity =
        intensity * (shell.kind === 'red' ? 0.55 : shell.kind === 'green' || shell.kind === 'mountGreen' ? 0.45 : 0.5);
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

  private updateGroundShadow(frame: EngineFrame): void {
    const shadow = this.groundShadow;
    if (!shadow) return;
    const material = shadow.material as THREE.MeshBasicMaterial;
    material.opacity = frame.groundShadow;
    shadow.visible = frame.groundShadow >= 0.01;
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

    // Drag offsets apply in every phase (not weighted by idleWeight, unlike the hero idle spin
    // above) -- they're a transient interaction layer on top of whatever beat is active.
    const azimuth = frame.azimuth + this.idleAzimuthOffset * frame.idleWeight + this.dragAzimuthOffset;
    const elevation = frame.elevation + this.dragElevationOffset;
    const x = distance * Math.cos(elevation) * Math.sin(azimuth);
    const y = distance * Math.sin(elevation);
    const z = distance * Math.cos(elevation) * Math.cos(azimuth);

    this.camera.position.set(sphere.center.x + x, sphere.center.y + y, sphere.center.z + z);
    this.camera.near = Math.max(0.01, distance - radius * 2);
    this.camera.far = distance + radius * 4;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(sphere.center);

    // Fog range tracks the same fitted distance/radius as the camera: assembled (small radius,
    // camera close) keeps near/far tight around the model so the effect stays subtle, while
    // exploded (large radius, camera far) spreads the range so the rearmost parts veil instead
    // of vanishing.
    const fog = this.scene.fog;
    if (fog instanceof THREE.Fog) {
      fog.near = Math.max(0.01, distance - radius * FOG_NEAR_RADIUS_FRACTION);
      fog.far = distance + radius * FOG_FAR_RADIUS_FRACTION;
    }
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
