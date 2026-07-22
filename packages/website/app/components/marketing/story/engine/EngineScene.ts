// The only file in the story that imports three. Everything here is orchestration around a
// single baked GLB: load it, bake its animation into a flat exploded/assembled pose pair per
// part (discarding the imported hierarchy so the `$AssimpFbx$` pivot chains vanish), then drive
// those poses each frame from the pure EngineFrame the caller computes via beats.ts.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { lerp } from '../scene';
import { type EngineFrame, HERO_IDLE_RATE } from './beats';
import {
  BLOOM_LAYER,
  buildHighlightRecords,
  HEARTBEAT_HZ,
  type HighlightRecord,
  pulseWave,
  updateHighlights
} from './highlights';
import {
  assembledGeometricCenter,
  assembledWorldBox,
  buildMismatchBoxes,
  computeMismatchBoxBounds,
  computePistonBoreAxes,
  updateBoundingBox,
  type WorldLine
} from './mismatchBox';
import {
  EXPLODE_DIRECTION_REFERENCE,
  EXPLODE_DIRECTION_REFERENCE_FRONT,
  EXPLODE_OVERRIDES,
  FAMILY_MATERIAL,
  FRONT_DRIVE,
  FRONT_MOUNT,
  familyOf,
  ORANGE_EMPHASIS,
  type PartFamily,
  stripDedupSuffix
} from './parts';
import { STAGE_BACKGROUND_DEFAULT } from './stage';
import type { PartRecord, Pose } from './types';
import engineGlbUrl from '~/assets/engine/engine.glb?url';
import engineAoUrl from '~/assets/engine/engine-ao.webp?url';
import engineNormalUrl from '~/assets/engine/engine-normal.webp?url';
import engineRoughnessUrl from '~/assets/engine/engine-roughness.webp?url';

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

// The stage's own backdrop (see EngineStage.tsx's containing div) -- the canvas itself is
// transparent (`alpha: true`, clear alpha 0, `scene.background = null`), so fogging to the same
// color the panel is rendering is what lets distant parts blend into it instead of a mismatched
// haze. The color is no longer static: engine/backdrop.ts computes it per-t (default + four color
// beats), and EngineFrame.backgroundColor carries that value in here every frame.

// Fog near/far are recomputed every frame in `fitCameraToFrame` relative to the fitted camera
// distance and the current bounding-sphere radius (both already vary continuously with explode
// state), so these are fractions of `radius`, not absolute distances. Fog is purely a depth cue
// for the *rear* of the exploded engine: `near` begins just past the frame's midline (fraction
// 0.15) so the front half stays fully clear, and `far` sits ~0.4 radii beyond the rearmost
// geometry (which sits at roughly `distance + radius`), so the very back picks up a moderate,
// noticeable haze -- roughly 55-70% of the near-to-far span -- toward the page background,
// without saturating. (Earlier values of 0.4/0.55 fogged the center ~40% and saturated the rear
// completely -- far too heavy. That was overcorrected to 0.0/2.2, which pushed `far` so far past
// the rear that even the rearmost part only reached a small fraction of fog density -- fog became
// imperceptible. This is the retuned middle ground.)
const FOG_NEAR_RADIUS_FRACTION = 0.15;
const FOG_FAR_RADIUS_FRACTION = 1.4;

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

// --- Ambient drift: whole-engine positional wander, independent of scroll ---------------------
// Gives the model depth/presence even while scroll is idle, in both collapsed and exploded states.
// Three sines with incommensurate periods/phases (no shared factor, so the combined motion never
// visibly repeats on a human timescale) summed into an absolute (never accumulated) offset from an
// elapsed-time clock -- see driftOffset below and its use in applyFrame/fitCameraToFrame. Amplitudes
// are a taste call, expressed as a fraction of the assembled bounding-sphere radius so the drift
// scales sensibly with the model rather than being a fixed world-unit constant; z (toward/away from
// camera) is deliberately the largest since depth read was the explicit goal. Raised ~2.5x from the
// original pass (0.012/0.01/0.02) after user feedback that the drift read as too subtle to notice --
// same unhurried pace (periods/phases untouched below), just more travel per cycle.
const DRIFT_AMPLITUDE_X = 0.03; // fraction of assembled radius
const DRIFT_AMPLITUDE_Y = 0.025;
const DRIFT_AMPLITUDE_Z = 0.05;
const DRIFT_PERIOD_X = 13; // seconds -- incommensurate with Y/Z so the combined path doesn't repeat
const DRIFT_PERIOD_Y = 17;
const DRIFT_PERIOD_Z = 11;
// Phase offsets so all three don't start in lockstep at t=0 (which would read as one straight-line
// diagonal motion for the first few seconds instead of a lazy wander).
const DRIFT_PHASE_X = 0;
const DRIFT_PHASE_Y = (2 * Math.PI) / 3;
const DRIFT_PHASE_Z = (4 * Math.PI) / 3;

// The t68-72 parallel-adjust beat (beats.ts's partAdjustAt / EngineFrame.partAdjust): each piston
// re-seats outward along its own bank's bore axis (see mismatchBox.ts's computePistonBoreAxes) by
// this fraction of the assembled bounding-sphere radius, at full partAdjust/explode weight --
// same "fraction of assembledRadius" convention as DRIFT_AMPLITUDE_X/Y/Z and WOBBLE_AMPLITUDE
// above, so it scales sensibly with the model instead of being a fixed world-unit constant. Kept
// small (2.5%) since this is a subtle "the parts are re-seating" cue riding alongside the ring
// regrow, not a second explode beat.
const PISTON_ADJUST_FRACTION = 0.025;

// --- Per-part wobble: free-floating jitter layered on top of the whole-group drift above ------
// Drift moves the whole assembly as one rigid body; this gives each of the ~129 parts its own tiny
// independent bob so the exploded constellation reads as loose, suspended debris rather than a
// single object wandering in place -- every part looks like it's individually adrift, not just
// riding along with its neighbors. Deterministic, not random: each part's phases and period
// multipliers are derived from its index in `this.parts` via a golden-angle scatter (irrational
// step per index, so no two parts ever land on the same phase/period and the pattern never visibly
// repeats), which means the exact same wobble plays out on every page load -- there is nothing here
// for a seeded RNG to buy over deriving straight from the index. Gated by the current frame's
// `explode` progress (0 at rest, full once fully exploded) so assembled metal stays perfectly rigid
// through the hero, the failed-fit collapsed hold, and the final reassembly from t87 on, and the
// float fades in exactly as parts separate -- this doubles as the "suspended parts float free" cue
// with no separate state to track. Position-only, deliberately no rotation: these meshes carry the
// GLB's baked (and frequently off-center) pivots, so even a cheap rotational wobble would visibly
// swing a part on an invisible arm around its pivot instead of reading as a gentle bob. No special-
// casing for the camera fit (fitCameraToFrame) or the mismatch glass boxes either: WOBBLE_AMPLITUDE
// is small enough that the fit's frame-to-frame sphere variation from it is negligible, and the
// glass-box padding is treated as this system's amplitude budget -- if a part is ever seen grazing
// its box, the fix is turning WOBBLE_AMPLITUDE down, not teaching the wobble about box bounds.
const WOBBLE_AMPLITUDE = 0.004; // fraction of assembled radius, same on all three axes
const WOBBLE_PERIOD_MIN = 5; // seconds -- per-part/per-axis period is scattered across this range
const WOBBLE_PERIOD_MAX = 9;
// Depth (radians) of the second-harmonic phase warp summed into each axis's primary sine below --
// enough to break the metronome feel of a single sine without the motion reading as erratic.
const WOBBLE_WARP = 0.7;
// The second harmonic's frequency/phase ride on the primary's via this multiplier -- the golden
// ratio is irrational, so the two harmonics never settle into a simple repeating beat.
const WOBBLE_HARMONIC_RATIO = 1.618033988749895;
// Golden angle: an irrational fraction of a full turn, so `index * WOBBLE_GOLDEN_ANGLE` scatters
// every part to a distinct, non-repeating phase as index increases -- the same trick as phyllotaxis
// (sunflower seed spirals) for even, non-clumping angular coverage of ~129 samples.
const WOBBLE_GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const WOBBLE_GOLDEN_RATIO_CONJUGATE = 0.6180339887498949;
// Arbitrary prime-ish index offsets so x/y/z each read a different point along the same golden-angle
// scatter instead of all three axes sharing one phase/period (which would collapse the bob to a
// single diagonal axis instead of a genuinely 3D float).
const WOBBLE_AXIS_INDEX_STRIDE_Y = 41;
const WOBBLE_AXIS_INDEX_STRIDE_Z = 83;

function fract(value: number): number {
  return value - Math.floor(value);
}

// One axis's wobble value for a given part index at a given wall-clock time, in roughly [-1, 1] --
// the caller scales by WOBBLE_AMPLITUDE * assembledRadius * explodeProgress. `axisIndex` is the
// part's own index shifted by one of the WOBBLE_AXIS_INDEX_STRIDE_* constants (or left as-is for
// x) so each axis samples a different point on the same deterministic scatter.
function wobbleAxisValue(axisIndex: number, time: number): number {
  const phase = axisIndex * WOBBLE_GOLDEN_ANGLE;
  const periodMultiplier = fract(axisIndex * WOBBLE_GOLDEN_RATIO_CONJUGATE);
  const period = WOBBLE_PERIOD_MIN + periodMultiplier * (WOBBLE_PERIOD_MAX - WOBBLE_PERIOD_MIN);
  const omega = (2 * Math.PI) / period;
  const warpPhase = phase * WOBBLE_HARMONIC_RATIO;
  return Math.sin(time * omega + phase + WOBBLE_WARP * Math.sin(time * omega * WOBBLE_HARMONIC_RATIO + warpPhase));
}

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

  // Bloomed highlight meshes whose color/env reflection were zeroed and whose emissive was scaled
  // by their continuous bloom gate (userData.bloomGate, see updateHighlights) for the bloom pass
  // only -- see darkenNonBloomed for why the bloom composer's input is emissive-only -- with the
  // originals stored here so restoreMaterial can undo it exactly.
  private readonly dimmedForBloom = new Map<
    THREE.Mesh,
    { color: THREE.Color; emissive: THREE.Color; envMapIntensity: number }
  >();

  private group: THREE.Group | null = null;
  private parts: PartRecord[] = [];
  private frontDriveParts: PartRecord[] = [];
  private mountPart: PartRecord | null = null;
  private orangeEmphasisParts: PartRecord[] = [];
  private highlights: HighlightRecord[] = [];
  private boundingBox: THREE.Group | null = null;

  // `group.position`'s resting (undrifted) value -- the recenter offset computed once in load() so
  // the assembled bounding-sphere center sits at the world origin. Ambient drift (see driftOffset
  // below) is applied on top of this every frame; group.position is never itself the source of
  // truth, so drift can never accumulate.
  private recenterOffset = new THREE.Vector3();
  // Assembled bounding-sphere radius, set once in load() -- ambient drift's amplitude is a fraction
  // of this (see DRIFT_AMPLITUDE_X/Y/Z) so it scales sensibly with the model instead of being a
  // fixed world-unit constant.
  private assembledRadius = 1;
  // Ambient whole-engine positional drift (see the DRIFT_* constants above and motionTick below):
  // recomputed absolutely from elapsed time every frame in motionTick, never accumulated, active
  // independent of scroll/explode state, and pinned to zero under prefers-reduced-motion.
  private driftOffset = new THREE.Vector3();
  // Wall-clock time (seconds) driving the per-part wobble (see the WOBBLE_* constants and
  // wobbleAxisValue above): updated alongside driftOffset in motionTick, from the same rAF
  // timestamp -- kept as its own field rather than reusing driftOffset's local `t` since wobble is
  // read later, per-part, inside updatePartTransforms rather than at the point drift is computed.
  // Frozen (not advanced) under prefers-reduced-motion; updatePartTransforms also gates its use on
  // `this.reducedMotion` directly so a frozen-but-stale clock value can never leak into the scene.
  private wobbleClock = 0;
  // Scratch vector for the per-part wobble offset in updatePartTransforms -- reused every part,
  // every frame, so laying out ~129 parts' wobble never allocates a Vector3 per part per frame.
  private readonly wobbleScratch = new THREE.Vector3();
  // The crank centerline (see mismatchBox.ts's WorldLine), derived once in load() from the
  // crankshaft's own geometry -- feeds computeMismatchBoxBounds's bore-axis-relative box
  // orientation (see mismatchBox.ts's computeBoreAxis).
  private crankLine: WorldLine | null = null;
  // Per-piston bore axes (see mismatchBox.ts's computePistonBoreAxes), populated once in load()
  // alongside the glass-box bounds -- reused every frame in updatePartTransforms to offset each
  // piston outward along its own bank's bore axis during the t68-72 partAdjust beat (see
  // beats.ts's partAdjustAt).
  private pistonBoreAxes: Map<PartRecord, THREE.Vector3> = new Map();
  // Shared crank-axis pivot the gear+mount rigid pair scales about in updatePartTransforms,
  // instead of each part's own local center -- see load()'s computation and updatePartTransforms's
  // use for the full rationale. Null only in the (untested-in-practice) case there's no crank line
  // to derive it from, in which case updatePartTransforms falls back to the old per-part behavior.
  private frontDriveScalePivot: THREE.Vector3 | null = null;
  // Parts with a parts.ts `rideWith` coupling (currently the two cylinder-head covers riding
  // throttleBody) must sample the SAME wobble value as their base part, not their own independent
  // `this.parts` index -- otherwise the two visibly shear against each other even though their
  // explode poses are now rigidly coupled (see load()'s rideWith pass above). Maps each such
  // PartRecord to the `this.parts` index its wobble should be sampled from instead of its own,
  // populated once in load().
  private wobbleIndexOverrides: Map<PartRecord, number> = new Map();

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
    // Color is a placeholder too -- fitCameraToFrame sets it every frame from the live
    // EngineFrame.backgroundColor (see engine/backdrop.ts), which tracks the stage panel's own
    // t-varying color exactly.
    this.scene.fog = new THREE.Fog(STAGE_BACKGROUND_DEFAULT, 1, 100);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);

    const key = new THREE.DirectionalLight(0xfff4e6, 2.0);
    key.position.set(3, 4, 5);
    this.scene.add(key);

    // Cool rim/fill, roughly opposite the key and slightly behind the model: guarantees a
    // camera-independent specular edge on silhouettes at orientations where the key's lobe and
    // the environment's brighter regions are both missed.
    const rim = new THREE.DirectionalLight(0xdde8ff, 1.1);
    rim.position.set(-4, 2.5, -5);
    this.scene.add(rim);

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
    // Threshold is 0 because it no longer needs to do any selecting: darkenNonBloomed now feeds
    // this composer an EMISSIVE-ONLY render (bloom-layer meshes' diffuse color and env reflection
    // are zeroed for this pass; only their emissive, scaled by the continuous bloomGate, survives)
    // -- so everything this pass sees already IS the glow, and there is no lit-metal/reflection
    // brightness left for a threshold to filter out. A threshold-based approach (0.92, then 0.96
    // after RoomEnvironment landed) was tried first and broke: under RoomEnvironment, linear-HDR
    // speculars off its bright all-around panels routinely exceed 1.0 on highlighted meshes, so
    // they cleared any threshold <= 1 from ordinary reflections alone, independent of the actual
    // highlight/pulse state -- no threshold could tell "reflecting a bright panel" apart from
    // "genuinely hot" once the input was the mesh's full lit render. Pop-free fade-in as a
    // highlight ramps up is guaranteed by bloomGate's continuous 0..1 scaling of the emissive
    // input (see darkenNonBloomed), not by this threshold, which is why threshold 0 is safe.
    // Strength 0.16 (down from 0.25, 0.5, originally 0.8) reflects the highlight redesign where
    // tint (color/metalness/roughness, see highlights.ts) carries the highlight's identity and
    // emissive is only a small decorative accent (EMISSIVE_SCALE cut 0.32 -> 0.09 -> 0.05) --
    // bloom is now a soft, local flourish on top of that accent rather than a major part of how
    // the highlight reads. This pass adds its halo additively on top of the base render in linear
    // HDR, before tone mapping, so on top of the already-bright tinted metal (RoomEnvironment +
    // key + rim) it keeps pushing highlighted pixels' combined luminance toward
    // ACESFilmicToneMapping's shoulder, where the tonemapper desaturates toward white. The 0.25
    // value read fine against the old static cream backdrop, but once the stage backdrop started
    // taking on its own saturated color during the color beats (see engine/backdrop.ts), the
    // halo's outward bleed competed with the panel's own color right at the part's silhouette --
    // the user flagged this directly ("the highlighted parts are glowing too much, and it looks
    // odd with the background"). Radius cut in step, 0.35 -> 0.22, since spread (not just
    // intensity) is what was reading as "external glow" bleeding into the colored panel.
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.16, 0.22, 0.0);
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
    // The renderer's antialias:true only covers the default framebuffer -- the scene is actually
    // rasterized into these composer render targets (samples:0 by default), so MSAA has to be
    // requested on them directly or the visible output stays aliased. setSize() below only resizes
    // these targets in three 0.185, it never recreates them, so setting samples once here persists
    // across resizes. The bloom composer is deliberately left non-multisampled: its output is
    // gaussian-blurred by UnrealBloomPass anyway, so MSAA there would just be wasted cost.
    this.composer.renderTarget1.samples = 4;
    this.composer.renderTarget2.samples = 4;

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
    // linear color space because none of these encode display-referred color. Anisotropic
    // filtering is maxed out here too, since the engine's top surfaces are viewed at a glancing
    // angle where isotropic minification mipmapping would otherwise moire these maps.
    for (const map of [normalMap, roughnessMap, aoMap]) {
      map.flipY = false;
      map.colorSpace = THREE.NoColorSpace;
      map.channel = 0;
      map.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    }

    // Procedural RoomEnvironment (a room lined with area-light panels on every wall) replaces an
    // earlier Poly Haven studio HDRI. The HDRI's luminance was directional -- a handful of bright
    // softbox regions against an otherwise dim equirect -- so at many of the rig's orientations
    // (drag-to-orbit included) the 0.8-0.9-metalness families' reflection vectors landed in the
    // HDRI's flat, dim regions and read as untextured flat gray instead of metal. RoomEnvironment's
    // panels surround the model on every side, so a reflection vector finds gradient structure to
    // reflect no matter which way the part is facing. scene.background stays null -- the canvas is
    // transparent (alpha:true) over the cream page and must never be painted over by the
    // environment map. RoomEnvironment needs no async load, so it's built and consumed here
    // synchronously rather than through the Promise.all above.
    const roomEnvironment = new RoomEnvironment();
    this.scene.environment = this.pmrem.fromScene(roomEnvironment, 0.04).texture;
    this.scene.background = null;
    roomEnvironment.dispose();
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

    // Rigid-coupling pass (parts.ts's `rideWith`, currently the two cylinder-head covers riding
    // `throttleBody`): a part with `rideWith` set discards whatever exploded pose the loop above
    // computed for it and instead inherits its base part's exploded DISPLACEMENT (assembled ->
    // exploded delta) verbatim, applied on top of its OWN assembled position -- so the pair's
    // assembled-relative arrangement is identical before and after explode; they can never cross
    // or separate. A second pass, not folded into the loop above, because a `rideWith` target's
    // own exploded pose (itself possibly overridden, though not in today's data) must already be
    // finalized before it can be copied from -- nothing guarantees `meshes` iterates in dependency
    // order.
    for (const mesh of meshes) {
      const override = EXPLODE_OVERRIDES[stripDedupSuffix(mesh.name)];
      if (!override?.rideWith) continue;
      const assembled = assembledPoses.get(mesh.uuid);
      if (!assembled) continue;
      const base = meshes.find((candidate) => stripDedupSuffix(candidate.name) === override.rideWith);
      const baseAssembled = base && assembledPoses.get(base.uuid);
      const baseExploded = base && explodedPoses.get(base.uuid);
      if (!base || !baseAssembled || !baseExploded) continue;
      const baseDisplacement = baseExploded.position.clone().sub(baseAssembled.position);
      explodedPoses.set(mesh.uuid, {
        position: assembled.position.clone().add(baseDisplacement),
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
        // Pushed past the map's default 1.0 scale: with RoomEnvironment's softer, more diffuse
        // gradient (versus the old HDRI's punchier softbox highlights), the normal map needs to
        // perturb reflection vectors harder for the machined surface detail to stay visible
        // instead of washing out against flatter regions of the environment.
        normalScale: new THREE.Vector2(1.5, 1.5),
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
        isOrangeEmphasis,
        localSphere
      });
    }

    // Recenter so the assembled bounding-sphere center sits at the world origin; camera-fit
    // math and the never-cropped rule both assume the rig's resting pose is centered.
    // `group.position` itself is set from `recenterOffset` (not computed inline) since ambient
    // drift (see applyDrift/motionTick) is layered on top of this same base position every frame.
    const assembledBox = new THREE.Box3().setFromObject(group);
    const assembledSphere = assembledBox.getBoundingSphere(new THREE.Sphere());
    this.recenterOffset.copy(assembledSphere.center).negate();
    this.assembledRadius = Math.max(assembledSphere.radius, 0.001);
    group.position.copy(this.recenterOffset);

    this.parts = parts;
    this.frontDriveParts = parts.filter((part) => part.isFrontDrive);
    this.mountPart = parts.find((part) => part.isMount) ?? null;
    this.orangeEmphasisParts = parts.filter((part) => part.isOrangeEmphasis);
    this.crankLine = this.deriveCrankLine(parts);

    // Wobble-coupling (see wobbleIndexOverrides's own comment): resolved here, once PartRecords
    // (and hence stable `this.parts` indices) exist, by re-reading each part's own `rideWith`
    // override and pointing it at its base part's index instead.
    this.wobbleIndexOverrides = new Map();
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      const override = EXPLODE_OVERRIDES[stripDedupSuffix(part.mesh.name)];
      if (!override?.rideWith) continue;
      const baseIndex = parts.findIndex((candidate) => stripDedupSuffix(candidate.mesh.name) === override.rideWith);
      if (baseIndex >= 0) this.wobbleIndexOverrides.set(part, baseIndex);
    }

    // Fix: the gear's baked exploded pose (EXPLODE_OVERRIDES's `reference`-direction
    // healthyDirection substitute, see parts.ts's comment on the `gear` entry) carries an off-axis
    // (upward) component -- reported as "the ring gear shifts up instead of staying aligned with
    // the crankshaft" whenever the engine is exploded. Reproject its exploded displacement onto the
    // crank axis alone (discarding the perpendicular component) so it slides straight off the
    // crank's own end instead of drifting sideways/upward. The mount (engineBackCover) gets the
    // SAME treatment for the same reason: it's the gear's rigid mating pair (see mountScaleAt's
    // comment in beats.ts) -- even though its own `direction: 'own'` axis (parts.ts's
    // EXPLODE_OVERRIDES) wasn't reported as visibly wrong, leaving it unprojected while the gear is
    // forced onto the crank axis alone is exactly the kind of asymmetric treatment that can reopen
    // the "pair drifts apart / clips" failure mode this whole fix exists to prevent -- projecting
    // both keeps their relative arrangement concentric on the crank axis at every explode weight,
    // not just verified-by-eye at one. The ordering invariant this preserves (see parts.ts's
    // `engineBackCover` EXPLODE_OVERRIDES comment: gear stays outboard of the cover at every blend
    // weight) becomes a pure 1-D comparison once both are projected onto the same axis: assembled
    // Z is engineBackCover ~= +65.6, gear ~= +72.3 (gear already further along +crankAxis at rest),
    // and the cover's `maxDistanceFraction: 0.63` cap keeps its along-axis exploded travel below
    // the gear's own -- so the ordering holds at every explode weight, not just at the endpoints.
    // Also: `this.crankLine.axis` (deriveCrankLine, above) can never carry a "stray" off-axis
    // component to begin with -- it's built as a one-hot unit vector on whichever single world axis
    // (x, y, or z) the crankshaft's bbox is longest along, so it is always EXACTLY axis-aligned by
    // construction, never a diagonal needing a snap/normalize pass.
    // Done here, right after the crank line is derived and BEFORE
    // the ring glass box bounds are computed below, so the box (and everything else keyed off
    // this.parts/this.frontDriveParts) sees the corrected pose. NOT done in parts.ts's
    // EXPLODE_OVERRIDES mechanism: that mechanism runs during the raw staging->assembled pose pass,
    // which happens before any PartRecord (and hence before the crank line, itself derived from the
    // crankshaft's own already-built PartRecord geometry via deriveCrankLine) exists -- a chicken-
    // and-egg ordering constraint that only resolves here, post-parts-construction. FRONT_DRIVE is
    // exactly ['gear'] (see parts.ts), so frontDriveParts[0] is unambiguously the gear.
    const gear = this.frontDriveParts[0];
    if (this.crankLine) {
      for (const part of [gear, this.mountPart]) {
        if (!part) continue;
        const displacement = part.exploded.position.clone().sub(part.assembled.position);
        const along = displacement.dot(this.crankLine.axis);
        part.exploded.position.copy(part.assembled.position).addScaledVector(this.crankLine.axis, along);
      }
    }

    // Shared scale pivot for the gear+mount rigid pair (see updatePartTransforms's use of
    // frontDriveScalePivot, and mountScaleWeightAt's comment in beats.ts for when the two do and
    // don't share a scale factor): the assembled midpoint of the two parts' own geometric centers
    // (mismatchBox.ts's assembledGeometricCenter -- real geometry, not baked mesh origins, same
    // rule as deriveCrankLine above), projected onto the crank axis so the pivot itself sits on the
    // engine's centerline rather than off to one side. Computed once here, at load time, from the
    // ASSEMBLED pose only -- not recomputed per-frame or re-derived from the (already crank-axis-
    // projected) exploded pose -- so it's a single fixed reference point the pair scales about
    // consistently across the whole timeline, exploded or not.
    if (gear && this.mountPart && this.crankLine) {
      const midpoint = assembledGeometricCenter(gear).add(assembledGeometricCenter(this.mountPart)).multiplyScalar(0.5);
      const toMidpoint = midpoint.clone().sub(this.crankLine.point);
      const along = toMidpoint.dot(this.crankLine.axis);
      this.frontDriveScalePivot = this.crankLine.point.clone().addScaledVector(this.crankLine.axis, along);
    }

    this.group = group;
    this.scene.add(group);

    this.highlights = buildHighlightRecords(this.frontDriveParts, this.mountPart, this.orangeEmphasisParts);
    // The ring container encloses the front-drive/mount pair (gear + engineBackCover); the two
    // piston-bank containers enclose the 8 pistons, split into banks internally by
    // computeMismatchBoxBounds. orangeEmphasisParts is exactly the 8 piston bodies today (see
    // parts.ts's ORANGE_EMPHASIS) -- filtered by mesh-name prefix here too, defensively, so a
    // future ORANGE_EMPHASIS addition that isn't a piston doesn't silently end up sized into a
    // piston-bank container instead of being dropped or given its own home.
    const ringParts = [...this.frontDriveParts, ...(this.mountPart ? [this.mountPart] : [])];
    const pistonParts = this.orangeEmphasisParts.filter((part) =>
      stripDedupSuffix(part.mesh.name).toLowerCase().startsWith('piston')
    );
    // this.crankLine is set by deriveCrankLine above whenever there's a crankshaft mesh to derive
    // it from; falls back to a world-Y line through the origin only in the (untested-in-practice)
    // case the GLB is missing a crankshaft mesh entirely, so this call never throws.
    const crankLine = this.crankLine ?? { point: new THREE.Vector3(), axis: new THREE.Vector3(0, 1, 0) };
    this.boundingBox = buildMismatchBoxes(
      computeMismatchBoxBounds({ ring: ringParts, pistons: pistonParts }, group, crankLine)
    );
    // Same bank split/bore-axis derivation the glass boxes above use (see mismatchBox.ts's
    // computePistonBoreAxes) -- reused every frame in updatePartTransforms for the t68-72
    // partAdjust beat (beats.ts's partAdjustAt). Populated here, not per-frame: the exploded pose
    // (and hence each bank's centroid/bore axis) is fixed at load time.
    this.pistonBoreAxes = computePistonBoreAxes(pistonParts, crankLine);
    // Parented under the engine `group`, NOT `scene` -- computeMismatchBoxBounds now measures every
    // part in GROUP-LOCAL space (part.mesh.matrix, not matrixWorld -- see mismatchBox.ts's
    // orientedBankBounds/axisAlignedBounds), so the containers' centers are group-local too. Parenting
    // here means the containers automatically inherit `group.position` (recenterOffset + the ambient
    // drift applied every frame in applyFrame) instead of standing still in world space while the
    // engine wanders -- previously the drift caused the end pistons to cyclically poke through the
    // (world-space, static) box ends.
    group.add(this.boundingBox);

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
      // Ambient drift is fully disabled under reduced motion too, the same "settle" behavior the
      // heartbeat/idle-spin already had -- pinning driftOffset at zero (rather than leaving it
      // wherever it stopped) guarantees the group settles back to exactly its resting recenterOffset.
      this.driftOffset.set(0, 0, 0);
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
    // Ambient drift (see the DRIFT_* constants and motionTick) is layered on top of the resting
    // recenterOffset every frame -- recomputed absolutely from this.driftOffset, never accumulated
    // into group.position directly, so it can never drift away from its intended amplitude.
    this.group.position.copy(this.recenterOffset).add(this.driftOffset);
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

      // Ambient drift -- entirely independent of scroll/EngineFrame state, same as the heartbeat
      // above and for the same reason: it should read as "alive" regardless of scroll position or
      // explode state. Computed as an ABSOLUTE offset from the rAF timestamp (never accumulated,
      // unlike pulseCycle/idleAzimuthOffset above) via three summed sines of incommensurate period
      // -- see the DRIFT_* constants' header comment. This loop already never settles while
      // !reducedMotion (the heartbeat above keeps it alive -- see the `settled` check below), so no
      // separate keep-alive is needed for this to run perpetually.
      const t = time / 1000;
      this.driftOffset.set(
        Math.sin(t * ((2 * Math.PI) / DRIFT_PERIOD_X) + DRIFT_PHASE_X) * DRIFT_AMPLITUDE_X * this.assembledRadius,
        Math.sin(t * ((2 * Math.PI) / DRIFT_PERIOD_Y) + DRIFT_PHASE_Y) * DRIFT_AMPLITUDE_Y * this.assembledRadius,
        Math.sin(t * ((2 * Math.PI) / DRIFT_PERIOD_Z) + DRIFT_PHASE_Z) * DRIFT_AMPLITUDE_Z * this.assembledRadius
      );

      // Per-part wobble's clock (see the WOBBLE_* constants and wobbleAxisValue) -- same rAF
      // timestamp as drift above, advanced only while motion is on so it freezes (rather than
      // resets) the instant reduced-motion engages.
      this.wobbleClock = t;
    }

    if (this.heroIdle) {
      this.idleAzimuthOffset += HERO_IDLE_RATE * dt;
      // Wrap the unbounded accumulator into (-pi, pi] so traverse's idleWeight fade-out (see
      // beats.ts's idleWeightAt) unwinds at most half a turn instead of potentially several full
      // turns baked up over a long hero hold -- see issue #2 in the tuning pass that added this.
      // Guarded to ONLY wrap while idleWeight is exactly 1 (i.e. still in `hero`, at `traverse`
      // l=0, or at t=100 once the RETURN_TO_NORMAL window has fully faded idleWeight back in): a
      // raw-value 2*pi jump is invisible to the blended camera azimuth ONLY at full weight, since
      // +-pi are 2*pi-equivalent camera positions there. Wrapping mid-fade (weight < 1) would show
      // as a visible snap, so it must never happen while either fade is in flight.
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

    for (let index = 0; index < this.parts.length; index++) {
      const part = this.parts[index];
      const k = part.isFrontDrive ? frame.frontDriveExplode : frame.explode;
      const basePos = part.assembled.position.clone().lerp(part.exploded.position, k);
      const baseQuat = part.assembled.quaternion.clone().slerp(part.exploded.quaternion, k);
      const baseScale = part.assembled.scale.clone().lerp(part.exploded.scale, k);

      const scaleFactor = part.isFrontDrive ? frame.frontDriveScale : part.isMount ? frame.mountScale : 1;
      const finalScale = baseScale.clone().multiplyScalar(scaleFactor);

      if (scaleFactor !== 1 && this.frontDriveScalePivot) {
        // scaleFactor is only ever non-1 for isFrontDrive/isMount parts (see its computation
        // above) -- the gear and mount are a rigid mating pair (see mountScaleWeightAt's comment in
        // beats.ts) that must move AS ONE whenever either one is scaling (they don't always scale
        // together -- e.g. only the gear moves during t22-27 -- but whenever the mount DOES scale,
        // t68-72, it's on the exact same window/target as the gear). Scaling each about its own
        // local center
        // independently (the old behavior, still kept below as a fallback) can let their facing
        // surfaces converge/interpenetrate as they grow, since the two local centers sit at
        // different distances from the seam between them. Scaling both about ONE shared pivot on
        // the crank axis instead (frontDriveScalePivot, computed once in load()) makes the pair
        // scale as a single rigid body: newPos = pivot + scaleFactor * (basePos - pivot) -- derived
        // from first-principles vertex-transform algebra, this produces the exact same result as
        // scaling every vertex of the part about that world pivot, regardless of where the part's
        // own local origin sits. Their separation from the shared pivot -- and hence from each
        // other -- therefore grows by exactly scaleFactor, never converging faster on one side.
        part.mesh.position
          .copy(this.frontDriveScalePivot)
          .addScaledVector(basePos.clone().sub(this.frontDriveScalePivot), scaleFactor);
      } else if (scaleFactor !== 1) {
        // Fallback for the untested-in-practice case there's no crank line (and hence no shared
        // pivot) to derive -- scale about the mesh's own local origin instead, compensating so the
        // resize reads as growth about the part's own center rather than a translation.
        const center = part.localSphere.center;
        const centerScaled = new THREE.Vector3(center.x * baseScale.x, center.y * baseScale.y, center.z * baseScale.z);
        const offset = centerScaled.multiplyScalar(1 - scaleFactor).applyQuaternion(baseQuat);
        part.mesh.position.copy(basePos).add(offset);
      } else {
        part.mesh.position.copy(basePos);
      }

      part.mesh.quaternion.copy(baseQuat);
      part.mesh.scale.copy(finalScale);

      // Parallel-adjust beat (item 5 / beats.ts's partAdjustAt, t68-72): while the ring gear
      // regrows, every piston visibly re-seats outward along its own bank's bore axis in the same
      // window -- the story beat is every coupled part adjusting in parallel with the change, not
      // one part moving at a time. Position-only, added on top of the beat pose just written above,
      // exactly like wobble below. Scaled by frame.explode (not a fixed 1) so the shift is a
      // fraction of the *live* separation, not a fixed world-space nudge -- it therefore vanishes
      // naturally through the t83-87 final reassembly (explode -> 0) with zero extra bookkeeping,
      // the same trick frontDriveExplode/wobble already lean on. Only parts with a bore axis (the 8
      // pistons, see load()'s computePistonBoreAxes call) are affected.
      const boreAxis = this.pistonBoreAxes.get(part);
      if (boreAxis) {
        part.mesh.position.addScaledVector(
          boreAxis,
          frame.partAdjust * PISTON_ADJUST_FRACTION * this.assembledRadius * frame.explode
        );
      }

      // Per-part wobble (see the WOBBLE_* constants above): position-only, added on top of the beat
      // pose just written above, recomputed absolutely from this.wobbleClock every call -- never
      // accumulated, so it composes cleanly with drift (which moves the group) without either one
      // fighting the other. Skipped outright under reduced motion (rather than relying on a frozen
      // clock alone) so a stale wobbleClock value can never leak into the scene. `frame.explode`
      // (not frontDriveExplode) gates every part uniformly, including front-drive ones -- the two
      // track each other exactly (see EngineFrame's frontDriveExplode comment in beats.ts), and
      // wobble is meant to read as "how separated is this part," which `explode` already answers.
      if (!this.reducedMotion) {
        // Rigidly-coupled parts (parts.ts's `rideWith`, see wobbleIndexOverrides's comment) sample
        // their BASE part's wobble index instead of their own, so the pair never shears against
        // each other even though wobble is otherwise per-part-independent.
        const wobbleIndex = this.wobbleIndexOverrides.get(part) ?? index;
        const wx = wobbleAxisValue(wobbleIndex, this.wobbleClock);
        const wy = wobbleAxisValue(wobbleIndex + WOBBLE_AXIS_INDEX_STRIDE_Y, this.wobbleClock);
        const wz = wobbleAxisValue(wobbleIndex + WOBBLE_AXIS_INDEX_STRIDE_Z, this.wobbleClock);
        this.wobbleScratch.set(wx, wy, wz);
        part.mesh.position.addScaledVector(this.wobbleScratch, WOBBLE_AMPLITUDE * this.assembledRadius * frame.explode);
      }
    }
  }

  // Derives the crank centerline from the crankshaft's own geometry, at load() time. This is the
  // one piece of the old running-engine rig this scene still needs: mismatchBox.ts's
  // computeBoreAxis uses it to orient each cylinder bank's glass box along the true bore direction
  // (see load()'s computeMismatchBoxBounds call site). Everything else the old setup used to
  // precompute here -- rotor pivots, piston bore axes/travel, rocker/spring bank assignment -- was
  // for the continuous running motion, which has been removed; only the crank line itself survives.
  //
  // The axis derived below comes from actual GEOMETRY (the crankshaft's world-space assembled
  // bounding box -- see mismatchBox.ts's assembledWorldBox/assembledGeometricCenter and its header
  // comment for why), never from the mesh's own `assembled.position` (its baked FBX pivot, which is
  // arbitrary and not reliably at the part's physical center) or from rotating a fixed local axis by
  // the mesh's own quaternion (most of these meshes carry a near-identity rotation regardless of
  // their visible tilt -- the tilt lives in the vertex data).
  private deriveCrankLine(parts: readonly PartRecord[]): WorldLine | null {
    const nameOf = (part: PartRecord) => stripDedupSuffix(part.mesh.name).toLowerCase();
    const byName = (name: string): PartRecord | undefined => parts.find((part) => nameOf(part) === name);

    const crankshaft = byName('crankshaft');
    const crankshaftSprocket = byName('crankshaftsprocket');

    if (!crankshaft) return null; // nothing to derive the crank line from

    // Crank axis: the crankshaft's own world-space assembled bounding box's DOMINANT axis (whichever
    // of world x/y/z has the largest extent, as a unit vector on that axis) -- NOT sprocket-origin-
    // minus-cover-origin (the previous derivation). That measured the vector between two mesh
    // ORIGINS -- arbitrary baked FBX pivots that aren't guaranteed to sit exactly on the crank's true
    // axis -- and any error there showed up directly as an off-axis tilt in every part rotating with
    // it. A long thin shaft's bounding box is overwhelmingly dominated by its length, so "largest
    // world-axis extent" reliably recovers the true shaft direction regardless of where its mesh
    // origin sits. This assumes the crankshaft's world bbox is genuinely longest along one clean
    // world axis rather than diagonal -- true for this rig, which bakes all part-to-part tilt into
    // vertex data rather than into any overall rig rotation (see mismatchBox.ts's geometry-derived-
    // centers header comment). Sign is then oriented toward the crank sprocket's geometric center, so
    // "positive" consistently means "toward the front of the engine."
    // Sanity expectation (recorded here since no runtime validation is permitted this session): per
    // parts.ts's measured coordinates (crankshaftSprocket, the front end, at Z≈-67; engineBackCover/
    // gear, the rear end, at Z≈+65..72), this should come out as ≈(0, 0, -1) -- i.e. ≈-Z, front-ward.
    const crankSize = new THREE.Vector3();
    assembledWorldBox(crankshaft).getSize(crankSize);
    const worldCrankAxis = new THREE.Vector3(
      crankSize.x >= crankSize.y && crankSize.x >= crankSize.z ? 1 : 0,
      crankSize.y >= crankSize.x && crankSize.y >= crankSize.z ? 1 : 0,
      crankSize.z >= crankSize.x && crankSize.z >= crankSize.y ? 1 : 0
    ).normalize();

    const crankshaftCenter = assembledGeometricCenter(crankshaft);
    if (crankshaftSprocket) {
      const towardSprocket = assembledGeometricCenter(crankshaftSprocket).sub(crankshaftCenter);
      if (towardSprocket.dot(worldCrankAxis) < 0) worldCrankAxis.negate();
    }

    return { point: crankshaftCenter, axis: worldCrankAxis };
  }

  private fitCameraToFrame(frame: EngineFrame): void {
    if (this.parts.length === 0) return;

    const sphere = new THREE.Sphere(new THREE.Vector3(), 0);
    const worldSphere = new THREE.Sphere();
    for (const part of this.parts) {
      worldSphere.copy(part.localSphere).applyMatrix4(part.mesh.matrixWorld);
      sphereUnion(sphere, worldSphere);
    }
    // part.mesh.matrixWorld inherits group.position, which includes the current ambient drift (see
    // applyFrame/motionTick) on top of recenterOffset -- so the union sphere's center above is
    // itself drifting every frame. If the fit below used it as-is, the camera would re-center on
    // the drifted model every frame and the drift would never be visible (worst case: a jittery
    // camera chasing its own fit target). Subtracting the current drift vector here makes the fit
    // "drift-blind": it always frames the engine's undrifted resting pose, so this.driftOffset
    // (applied to group.position, not to the camera) reads as genuine on-screen motion instead of
    // being canceled out.
    sphere.center.sub(this.driftOffset);
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
      fog.color.setHex(frame.backgroundColor);
    }
  }

  // Swaps every mesh NOT on BLOOM_LAYER (i.e. everything not currently glowing -- see
  // updateHighlights) to a flat black material -- see the bloom pipeline comment in the
  // constructor for why this, rather than camera-layer exclusion, is what keeps opaque parts
  // correctly occluding glowing parts behind them during the bloom-only pass.
  private darkenNonBloomed = (object: THREE.Object3D): void => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (bloomLayerTest.test(mesh.layers)) {
      // The bloom composer's input is EMISSIVE-ONLY: a bloom-layer mesh's diffuse color and env
      // reflection are always zeroed for this pass (regardless of gate), so nothing but its own
      // emissive -- scaled by the continuous bloomGate below -- can ever feed UnrealBloomPass.
      // This decouples glow intensity from scene lighting/environment entirely. It replaces an
      // earlier approach that let the mesh's full lit render (diffuse + HDRI speculars) into the
      // bloom pass above a threshold: under RoomEnvironment, linear-HDR speculars off its bright
      // panels routinely exceed 1.0, clearing any threshold <= 1 on their own, so a highlighted
      // mesh bloomed from ordinary reflections, not from its emissive pulse, no matter how high
      // the threshold was pushed.
      //
      // updateHighlights publishes a continuous 0..1 gate (userData.bloomGate) that tracks the
      // highlight's magnitude; it scales the emissive going into this pass so a part eases into
      // the bloom input in step with its highlight rather than arriving all at once the instant
      // it joins BLOOM_LAYER.
      const gate = (mesh.userData.bloomGate as number | undefined) ?? 1;
      const material = mesh.material as THREE.MeshStandardMaterial;
      this.dimmedForBloom.set(mesh, {
        color: material.color.clone(),
        emissive: material.emissive.clone(),
        envMapIntensity: material.envMapIntensity
      });
      material.color.setScalar(0);
      material.emissive.multiplyScalar(gate);
      material.envMapIntensity = 0;
      return;
    }
    this.darkenedMaterials.set(mesh, mesh.material);
    mesh.material = DARK_MATERIAL;
  };

  private restoreMaterial = (object: THREE.Object3D): void => {
    const mesh = object as THREE.Mesh;
    const dimmed = this.dimmedForBloom.get(mesh);
    if (dimmed) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.color.copy(dimmed.color);
      material.emissive.copy(dimmed.emissive);
      material.envMapIntensity = dimmed.envMapIntensity;
      this.dimmedForBloom.delete(mesh);
    }
    const material = this.darkenedMaterials.get(mesh);
    if (!material) return;
    mesh.material = material;
    this.darkenedMaterials.delete(mesh);
  };

  private render(): void {
    // Pass 1: bloom-only, full scene/depth, but every non-glowing mesh temporarily flat black so
    // it contributes nothing to the bloom threshold while still occluding glowing parts behind it
    // correctly.
    //
    // The translucent mismatch box is excluded from this pass outright rather than darkened:
    // darkenNonBloomed's stand-in is opaque, and mixPass sums ALPHA as well as color -- so an
    // opaque stand-in writes alpha=1 across the box's whole silhouette in the bloom buffer, which
    // (on this alpha:true, page-composited canvas) makes the final canvas fully opaque there and
    // renders the "translucent" box as a solid slab of premultiplied green over the page
    // background. Hiding it for the pass also keeps its bright green edge lines (LineSegments,
    // which darkenNonBloomed's isMesh check never swaps) from feeding the bloom threshold.
    if (this.boundingBox) this.boundingBox.visible = false;
    this.scene.traverse(this.darkenNonBloomed);
    this.bloomComposer.render();
    this.scene.traverse(this.restoreMaterial);
    // Restores the frame-appropriate visibility (updateBoundingBox owns the visibility rule).
    updateBoundingBox(this.boundingBox, this.currentFrame?.boxWeight ?? 0);
    // Pass 2: normal full-scene render with every material restored; mixPass adds the bloom
    // texture from pass 1 back in additively.
    this.composer.render();
  }
}
