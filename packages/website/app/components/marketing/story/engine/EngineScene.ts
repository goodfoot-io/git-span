// The only file in the story that imports three. Everything here is orchestration around a
// single baked GLB: load it, bake its animation into a flat exploded/assembled pose pair per
// part (discarding the imported hierarchy so the `$AssimpFbx$` pivot chains vanish), then drive
// those poses each frame from the pure EngineFrame the caller computes via beats.ts.
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { lerp } from '../scene';
import { type EngineFrame, HERO_IDLE_RATE, MOUNT_SCALE } from './beats';
import {
  BLOOM_LAYER,
  buildHighlightRecords,
  HEARTBEAT_HZ,
  type HighlightRecord,
  pulseWave,
  updateHighlights
} from './highlights';
import { buildBoundingBox, computeMismatchBoxBounds, updateBoundingBox } from './mismatchBox';
import {
  EXPLODE_DIRECTION_REFERENCE,
  EXPLODE_DIRECTION_REFERENCE_FRONT,
  EXPLODE_OVERRIDES,
  FAMILY_MATERIAL,
  FRONT_DRIVE,
  FRONT_DRIVE_SEAT_ADJUST,
  FRONT_MOUNT,
  familyOf,
  ORANGE_EMPHASIS,
  type PartFamily,
  stripDedupSuffix
} from './parts';
import type { PartRecord, Pose } from './types';
import engineGlbUrl from '~/assets/engine/engine.glb?url';
import engineAoUrl from '~/assets/engine/engine-ao.webp?url';
import engineNormalUrl from '~/assets/engine/engine-normal.webp?url';
import engineRoughnessUrl from '~/assets/engine/engine-roughness.webp?url';
import studioHdrUrl from '~/assets/engine/studio_small_08_1k.hdr?url';

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

const bloomLayerTest = new THREE.Layers();
bloomLayerTest.set(BLOOM_LAYER);
// fog: false is required here, not cosmetic -- with fog on (the default), this "black" stand-in
// would still blend toward the scene's cream fog color at distance during the bloom-only pass
// (see render()'s darkenNonBloomed), which could push distant/heavily-exploded parts bright enough
// to cross UnrealBloomPass's threshold and bloom on their own, contaminating the pass with light
// that has nothing to do with any real highlight.
const DARK_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });

export class EngineScene {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly pmrem: THREE.PMREMGenerator;
  // bloomComposer renders the full scene (real depth, so opaque parts still occlude glowing parts
  // behind them) but with every non-glowing mesh darkened to black first (see render()'s
  // darkenNonBloomed), into an offscreen texture; composer does the normal full-scene render and
  // mixes that bloom texture back in additively (mixPass) -- see the constructor and render() for
  // the sequence.
  private readonly bloomComposer: EffectComposer;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  // Materials swapped out by darkenNonBloomed for the duration of the bloom pass, keyed by mesh so
  // restoreMaterial (right after) can put each one back exactly as it was.
  private readonly darkenedMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

  private group: THREE.Group | null = null;
  private parts: PartRecord[] = [];
  private frontDriveParts: PartRecord[] = [];
  private mountPart: PartRecord | null = null;
  private orangeEmphasisParts: PartRecord[] = [];
  private highlights: HighlightRecord[] = [];
  private boundingBox: THREE.Group | null = null;

  private currentFrame: EngineFrame | null = null;
  private heroIdle = false;
  private idleAzimuthOffset = 0;

  // Highlight heartbeat: an independent wall-clock pulse (see pulseWave above) layered onto every
  // highlight color (orange/blue/ringRed/red/pistonRed/finalGreen alike -- see
  // buildHighlightRecords/updateHighlights), entirely decoupled from the scroll-driven EngineFrame
  // -- it keeps beating at a constant real-time rate regardless of scroll position or scrub
  // direction. Off (pulseWeight pinned to 0, no accumulation) under prefers-reduced-motion.
  private reducedMotion = false;
  private pulseCycle = 0; // 0..1, one HEARTBEAT_HZ period
  private pulseWeight = 0;

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
    // ACESFilmic over the earlier AgX pick: AgX was A/B'd in before the emissive/bloom highlight
    // pass existed (see EngineScene's wiki doc for that original writeup) and rolls off highlights
    // hard by design -- exactly the range UnrealBloomPass's threshold needs to read cleanly to tell
    // "hot" emissive pixels from ordinary lit metal. ACES keeps the same filmic shoulder on the
    // gray-metal families while letting genuinely bright emissive values clear the bloom threshold
    // instead of being pre-crushed toward the AgX gamut boundary. Exposure kept at the same tuned
    // value; ACES's own contrast curve is close enough to AgX's here that the cream-page brightness
    // balance didn't need re-tuning.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
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

    // Bloom postprocessing -- SELECTIVE, via the classic "darken non-bloomed materials" technique
    // (not camera-layer exclusion -- an earlier version of this restricted the bloom pass's camera
    // to BLOOM_LAYER only, which meant opaque parts were never drawn at all in that pass, so
    // glowing parts never depth-tested against them and their glow bled through parts that should
    // have occluded them). Instead, darkenNonBloomed/restoreMaterial (see render()) swap every
    // non-glowing mesh's material to a flat black one for the bloom pass only -- the FULL scene,
    // with real depth, still draws every frame, so opaque parts correctly occlude glowing parts
    // behind them; those parts just contribute nothing to the bloom pass's brightness, since black
    // is always under threshold. Only parts with a nonzero highlight (updateHighlights enables
    // BLOOM_LAYER on them per-frame, used here purely as a lookup marker, not for camera/render
    // exclusion) keep their real material, emissive contribution included.
    //
    // bloomComposer's RenderPass renders that darkened scene through the same camera; UnrealBloomPass
    // then blurs/thresholds it into bloomPass's render target.
    //
    // composer is the normal full-scene render (camera restored to its default layer before this
    // runs), with mixPass adding the bloom texture back on top additively, and OutputPass applying
    // the final sRGB conversion last. Sizes are placeholders here -- resize() (called at the end of
    // this constructor, and on every container resize) is the single source of truth for
    // composer/pass dimensions, matching the renderer.
    this.bloomComposer = new EffectComposer(this.renderer);
    this.bloomComposer.renderToScreen = false;
    this.bloomComposer.addPass(new RenderPass(this.scene, this.camera));
    // Threshold/strength/radius are tuned to stay a restrained, local accent on the hottest
    // highlights at pulse peak -- see the "Highlight heartbeat" constants above for how
    // emissiveIntensity is kept under this threshold outside of pulse peaks on a fully-active
    // highlight.
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.35, 0.92);
    this.bloomComposer.addPass(this.bloomPass);

    const mixPass = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: {
          baseTexture: { value: null },
          bloomTexture: { value: this.bloomComposer.renderTarget2.texture }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D baseTexture;
          uniform sampler2D bloomTexture;
          varying vec2 vUv;
          void main() {
            gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv);
          }
        `
      }),
      'baseTexture'
    );
    mixPass.needsSwap = true;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(mixPass);
    this.composer.addPass(new OutputPass());

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

    // A second, independent reference direction for the front-drive end (belt/crankshaftSprocket/
    // camshaftSprocket) -- their own raw axes point the wrong way (see EXPLODE_OVERRIDES's
    // comment on those entries), and `healthyDirection` above can't serve both ends of the engine
    // at once (gear needs +Z-ish outward, these need -Z-ish outward -- averaging would cancel).
    const frontHealthyDirection = new THREE.Vector3();
    for (const mesh of meshes) {
      if (!EXPLODE_DIRECTION_REFERENCE_FRONT.includes(stripDedupSuffix(mesh.name))) continue;
      const raw = rawExplode.get(mesh.uuid);
      if (raw) frontHealthyDirection.add(raw.direction);
    }
    if (frontHealthyDirection.lengthSq() < POSE_EPSILON) frontHealthyDirection.set(0, 0, -1);
    frontHealthyDirection.normalize();

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
      const direction =
        override?.direction === 'reference'
          ? healthyDirection
          : override?.direction === 'frontReference'
            ? frontHealthyDirection
            : raw.direction;

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
    const orangeEmphasisSet = new Set(ORANGE_EMPHASIS);
    const parts: PartRecord[] = [];

    for (const mesh of meshes) {
      const assembled = assembledPoses.get(mesh.uuid);
      const exploded = explodedPoses.get(mesh.uuid);
      if (!assembled || !exploded) continue;

      const geometry = mesh.geometry;
      geometry.computeBoundingSphere();
      const localSphere = geometry.boundingSphere?.clone() ?? new THREE.Sphere();

      const family = familyOf(mesh.name);
      const strippedName = stripDedupSuffix(mesh.name);
      const isFrontDrive = frontDriveSet.has(strippedName);
      const isMount = frontMountSet.has(strippedName);
      const isOrangeEmphasis = orangeEmphasisSet.has(strippedName);
      // Highlightable parts (front-drive, mount, orange-emphasis) get their own material clone
      // rather than the family's shared instance -- updateHighlights drives emissive directly on
      // each one, and a shared material would leak one part's glow onto every other part of the
      // same family.
      const material = isFrontDrive || isMount || isOrangeEmphasis ? materialFor(family).clone() : materialFor(family);
      const partMesh = new THREE.Mesh(geometry, material);
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
        isFrontDrive,
        isMount,
        isSeatAdjust: seatAdjustSet.has(strippedName),
        isOrangeEmphasis,
        localSphere
      });
    }

    // Recenter so the assembled bounding-sphere center sits at the world origin; camera-fit
    // math and the never-cropped rule both assume the rig's resting pose is centered.
    const assembledBox = new THREE.Box3().setFromObject(group);
    const assembledSphere = assembledBox.getBoundingSphere(new THREE.Sphere());
    group.position.copy(assembledSphere.center).negate();

    this.parts = parts;
    this.frontDriveParts = parts.filter((part) => part.isFrontDrive);
    this.mountPart = parts.find((part) => part.isMount) ?? null;
    this.orangeEmphasisParts = parts.filter((part) => part.isOrangeEmphasis);

    this.group = group;
    this.scene.add(group);

    this.highlights = buildHighlightRecords(this.frontDriveParts, this.mountPart, this.orangeEmphasisParts);
    const mismatchParts = [
      ...this.frontDriveParts,
      ...this.orangeEmphasisParts,
      ...(this.mountPart ? [this.mountPart] : [])
    ];
    this.boundingBox = buildBoundingBox(computeMismatchBoxBounds(mismatchParts, group));
    this.scene.add(this.boundingBox);

    this.resize();
    this.ensureMotionLoop(); // starts the highlight heartbeat (see motionTick); settles on its own if reduced-motion is on and nothing else is animating
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

  // Gates the highlight heartbeat (see the "Highlight heartbeat" constants above). Off entirely
  // under prefers-reduced-motion: pulseCycle stops accumulating and pulseWeight is pinned to 0,
  // so highlights sit at their base (non-vivid) color with no per-frame flashing.
  setReducedMotion(on: boolean): void {
    if (on === this.reducedMotion) return;
    this.reducedMotion = on;
    if (on) {
      this.pulseWeight = 0;
      if (this.currentFrame) this.applyFrame(this.currentFrame);
    } else {
      this.ensureMotionLoop();
    }
  }

  resize(): void {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // Both composers own their own render targets (bloom's mip chain included) sized off the
    // renderer's pixel ratio -- all three must be kept in lockstep with the renderer or bloom's
    // halo resamples at the wrong resolution and either smears or clips at the canvas edge.
    this.bloomComposer.setPixelRatio(dpr);
    this.bloomComposer.setSize(width, height);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(width, height);
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
    this.bloomPass.dispose();
    this.bloomComposer.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.pmrem.dispose();
  }

  // --- internals -----------------------------------------------------------------------

  private applyFrame(frame: EngineFrame): void {
    if (!this.group || !this.mountPart) return;
    this.updatePartTransforms(frame);
    this.group.updateMatrixWorld(true);
    updateHighlights(this.highlights, frame, this.pulseWeight);
    updateBoundingBox(this.boundingBox, frame.boxWeight);
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

  // The one rAF driver for every transient (non-choreography) motion: hero idle spin, drag
  // snap-back, and the highlight heartbeat. Runs while any of the three is active and stops
  // itself once all have settled, rather than each maintaining a competing loop.
  private readonly motionTick = (time: number): void => {
    const dt = this.motionLastTime ? Math.min((time - this.motionLastTime) / 1000, 0.1) : 0;
    this.motionLastTime = time;

    if (!this.reducedMotion) {
      // Wall-clock oscillation, entirely independent of scroll/EngineFrame state -- keeps
      // beating at HEARTBEAT_HZ regardless of scroll position, direction, or scrub speed.
      this.pulseCycle = (this.pulseCycle + HEARTBEAT_HZ * dt) % 1;
      this.pulseWeight = pulseWave(this.pulseCycle);
    }

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

    try {
      if (this.currentFrame) this.applyFrame(this.currentFrame);
      else this.render();
    } catch (error) {
      // A render-path exception must never silently kill this self-perpetuating rAF chain -- if
      // it did, the highlight heartbeat (and idle spin, and drag snap-back) would stop advancing
      // entirely, and the scene would only repaint on the next externally-triggered call
      // (setFrame from scroll, or resize). That would make every one of these loop-driven
      // animations look like it's tracking scroll instead of running independently of it.
      console.error('EngineScene motionTick render failed', error);
    }

    const settled =
      !this.heroIdle && this.reducedMotion && this.dragAzimuthOffset === 0 && this.dragElevationOffset === 0;
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

      part.mesh.quaternion.copy(baseQuat);
      part.mesh.scale.copy(finalScale);
    }
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

  // Swaps every mesh NOT on BLOOM_LAYER (i.e. everything not currently glowing -- see
  // updateHighlights) to a flat black material -- see the bloom pipeline comment in the
  // constructor for why this, rather than camera-layer exclusion, is what keeps opaque parts
  // correctly occluding glowing parts behind them during the bloom-only pass.
  private darkenNonBloomed = (object: THREE.Object3D): void => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || bloomLayerTest.test(mesh.layers)) return;
    this.darkenedMaterials.set(mesh, mesh.material);
    mesh.material = DARK_MATERIAL;
  };

  private restoreMaterial = (object: THREE.Object3D): void => {
    const mesh = object as THREE.Mesh;
    const material = this.darkenedMaterials.get(mesh);
    if (!material) return;
    mesh.material = material;
    this.darkenedMaterials.delete(mesh);
  };

  private render(): void {
    // Pass 1: bloom-only, full scene/depth, but every non-glowing mesh temporarily flat black so
    // it contributes nothing to the bloom threshold while still occluding glowing parts behind it
    // correctly.
    this.scene.traverse(this.darkenNonBloomed);
    this.bloomComposer.render();
    this.scene.traverse(this.restoreMaterial);
    // Pass 2: normal full-scene render with every material restored; mixPass adds the bloom
    // texture from pass 1 back in additively.
    this.composer.render();
  }
}
