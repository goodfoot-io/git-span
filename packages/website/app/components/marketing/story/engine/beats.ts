// Pure SceneState -> EngineFrame choreography. No three imports: this module is the animation's
// contract, safe to import from React render paths and unit-reasoned-about without a WebGL
// context. Every quantity below is computed directly from (phase, local) — never from a
// previous call's output — so scrubbing the scroll timeline backwards is exactly as valid as
// scrubbing it forwards.
import { clamp01, ease, lerp, type PhaseId, ramp, type SceneState, TIMELINE } from '../scene';

// --- Tunable constants -------------------------------------------------------------------
export const FRONT_SCALE = 1.15; // front-drive parts' scale at the top of `change`
export const MOUNT_SCALE = 1.15; // FRONT_MOUNT's (engineBackCover's) scale at the top of `related`
export const FAIL_STOP = 0.5; // residual front-drive explode in `failure` — the gap that won't close

export const HIGHLIGHT_GREEN = '#34d399';
export const HIGHLIGHT_RED = '#ef4444';
export const LINK_AMBER = '#d97706';
// A pre-highlight pulse on the gear + engineBackCover right around when the camera settles into
// its canonical framing (see CAMERA_SETTLE_T) -- a distinct hue from LINK_AMBER so it doesn't read
// as the later linkage beat.
export const HIGHLIGHT_ORANGE = '#f97316';

// The fit is bounding-sphere based, which already over-estimates the model's visual footprint —
// these margins stay modest so the engine reads generously while still never touching the frame.
// Margin is a scale-invariant padding ratio on the *current* bounding sphere (fitCameraToFrame
// recomputes camera distance from whatever sphere is live each frame), so a smaller margin always
// reads as "more zoomed in," never as cropping -- safe to switch per-phase without blending.
export const MARGIN_ASSEMBLED = 1.12; // camera margin for hero (idle turntable needs headroom)
export const MARGIN_EXPLODED = 0.85; // constellation phases (traverse/change/second/span/related)
// -- the sphere fit overestimates the constellation's actual silhouette (parts explode along
// specific directions, not isotropically, so the bounding sphere has empty corners no geometry
// ever reaches), so this sits below 1.0 to compensate and still lands the visible cluster close
// to the frame edge; see the header comment above and iterate against real screenshots, not the
// number in isolation.
export const MARGIN_FAILURE = 1.06; // tighter margin from `failure` onward (auto push-in)

// Hero holds a level, end-on shot down the crankshaft axis — the front (sprocket/belt) end
// facing the camera, as the engine would present mounted in a car; `traverse` eases up into the
// canonical three-quarter technical-drawing angle that every later phase holds. The crank runs
// along model Z (crankshaftSprocket at the front, Z ≈ -67; gear/flywheel end at Z ≈ +72) —
// azimuth = PI points the camera at the front end: EngineScene's fitCameraToFrame places the
// camera at (distance*sin(azimuth), ..., distance*cos(azimuth)), so azimuth 0 sits on +Z looking
// toward -Z (gear end facing camera) and azimuth PI sits on -Z looking toward +Z (front end
// facing camera, gear end away) — the orientation this hero wants.
const HERO_AZIMUTH = Math.PI;
const HERO_ELEVATION = (6 * Math.PI) / 180; // a touch above dead level for a natural stance
export const CANONICAL_AZIMUTH = (35 * Math.PI) / 180;
export const CANONICAL_ELEVATION = (18 * Math.PI) / 180;

// Pure function of `t`, applied on top of the phase-held azimuth across the whole timeline —
// keeps parallax alive while scrubbing without breaking reversibility.
export const AZIMUTH_DRIFT = (18 * Math.PI) / 180;

// The hero's only time-based motion: one full turn every 45s, applied by EngineScene while
// setHeroIdle(true) and frozen under prefers-reduced-motion.
export const HERO_IDLE_RATE = (2 * Math.PI) / 45;

// The explode ramp — and everything that rides along with it: camera margin, the azimuth/
// elevation approach to the canonical angle, and the idle-orbit fade — now starts at the very
// first pixel of scroll rather than waiting for `traverse` to begin: the user should see
// separation begin immediately. `heroTraverseProgress` is one continuous, monotonic 0..1
// function of `t` spanning from the top of `hero` (t=0, fully assembled) to the end of
// `traverse` (fully exploded/canonical) — hero and traverse share a single curve instead of two
// curves glued at a phase boundary, which is what guarantees C0 (in fact C1) continuity across
// the hero -> traverse seam with no extra bookkeeping.
const TRAVERSE_END_T = TIMELINE.find((phase) => phase.id === 'traverse')!.end;

// The hero->canonical camera move (and everything riding heroTraverseProgress with it -- explode,
// margin) now fully settles here rather than at the actual end of `traverse` (TRAVERSE_END_T,
// ~18.18): reaching CANONICAL_AZIMUTH/CANONICAL_ELEVATION/MARGIN_EXPLODED/full-explode by
// CAMERA_SETTLE_T and holding flat for the remainder of `traverse` keeps the framing rock-stable
// while the "Your code is full of relationships it can't express." copy (traverse's prose) is on
// screen, instead of the camera still visibly rotating/pulling back well after that copy appears.
const CAMERA_SETTLE_T = 12.3;
function heroTraverseProgress(t: number): number {
  return ease(clamp01(t / CAMERA_SETTLE_T));
}

// Idle rotation must fade out well before the scripted explode motion is underway, or the two
// visibly fight. Fades over a short leading fraction of the hero+traverse span, starting at t=0
// (first scroll) instead of waiting for `traverse` to begin, as it did previously.
const IDLE_FADE_FRACTION = 0.3;

export interface EngineFrame {
  explode: number; // 0..1, all parts except front drive
  frontDriveExplode: number; // 0..1 (+FAIL_STOP residual in failure)
  frontDriveScale: number; // 1..FRONT_SCALE
  mountScale: number; // 1..MOUNT_SCALE
  seatAdjust: number; // 0..1 -- success-only: FD seats to mount-scaled anchors
  frontDriveLift: number; // 0..1 -- gear's lift off its seat; EngineScene resolves this into a
  // world-unit offset (a fraction of the gear's own radius). Ramps in during `change` on the same
  // curve as frontDriveScale and holds at 1 permanently from the end of `change` onward -- the
  // lift, like the resize, is a modification the story never undoes.
  green: number;
  red: number;
  amber: number;
  mountGreen: number;
  preHighlightOrange: number; // 0..1 -- orange pulse on gear + engineBackCover, ~t 7.5-19
  azimuth: number;
  elevation: number;
  margin: number;
  idleWeight: number; // 0..1 -- how much of the accumulated hero idle rotation the camera keeps
  groundShadow: number; // 0..1 -- fake contact-shadow plane opacity; see groundShadowAt below
}

function explodeAt(phase: PhaseId, l: number, t: number): number {
  switch (phase) {
    // hero and traverse share one curve (heroTraverseProgress) so explode starts ramping at the
    // very first pixel of scroll (t just above 0, still inside `hero`) and reaches 1 exactly at
    // the end of `traverse`, matching `change`'s held value with no seam.
    case 'hero':
    case 'traverse':
      return heroTraverseProgress(t);
    case 'change':
      return 1;
    case 'failure':
      return lerp(1, 0, ease(ramp(l, 0, 0.65)));
    case 'second':
      return lerp(0, 1, ease(ramp(l, 0, 0.6)));
    case 'span':
    case 'related':
      return 1;
    case 'success':
      return lerp(1, 0, ease(ramp(l, 0, 0.7)));
  }
}

function frontDriveExplodeAt(phase: PhaseId, l: number, t: number): number {
  switch (phase) {
    case 'hero':
    case 'traverse':
      return heroTraverseProgress(t); // tracks explode -- unison motion, no separate axis
    case 'change':
      return 1;
    case 'failure':
      return lerp(1, FAIL_STOP, ease(ramp(l, 0, 0.65)));
    case 'second':
      return lerp(FAIL_STOP, 1, ease(ramp(l, 0, 0.6)));
    case 'span':
    case 'related':
      return 1;
    case 'success':
      return lerp(1, 0, ease(ramp(l, 0, 0.7)));
  }
}

// Resize/lift ramp window, expressed directly in `t` (not local `l`) so it's pinned to an exact
// scroll position rather than a phase-relative fraction: both complete by CHANGE_RESIZE_END_T
// (~28), in step with the green/red highlight window below (GLOW_IN_START_T..GLOW_OUT_END_T,
// ~23.5-29) rather than change's earlier [0.15,0.75]-local window (~t 20.9-31.8).
const CHANGE_RESIZE_START_T = 24;
const CHANGE_RESIZE_END_T = 28;

function frontDriveScaleAt(phase: PhaseId, t: number): number {
  switch (phase) {
    case 'hero':
    case 'traverse':
      return 1;
    case 'change':
      return lerp(1, FRONT_SCALE, ramp(t, CHANGE_RESIZE_START_T, CHANGE_RESIZE_END_T));
    // Holds at FRONT_SCALE from the end of `change` onward -- never respecified, including
    // through `success`: the resize is a change that sticks, not something the story undoes.
    case 'failure':
    case 'second':
    case 'span':
    case 'related':
    case 'success':
      return FRONT_SCALE;
  }
}

// Mirrors frontDriveScaleAt's ramp shape exactly -- the gear's "growing larger and moving up
// relative to the engineBackCover" is one modification introduced together in `change` and held
// together forever after. Kept as a separate field (rather than reusing frontDriveScale directly
// as the lift weight) so EngineScene can scale it into world units independently of the scale
// factor's own numeric range.
function frontDriveLiftAt(phase: PhaseId, t: number): number {
  switch (phase) {
    case 'hero':
    case 'traverse':
      return 0;
    case 'change':
      return lerp(0, 1, ramp(t, CHANGE_RESIZE_START_T, CHANGE_RESIZE_END_T));
    case 'failure':
    case 'second':
    case 'span':
    case 'related':
    case 'success':
      return 1;
  }
}

function mountScaleAt(phase: PhaseId, l: number): number {
  switch (phase) {
    case 'hero':
    case 'traverse':
    case 'change':
    case 'failure':
    case 'second':
    case 'span':
      return 1;
    case 'related':
      return lerp(1, MOUNT_SCALE, ramp(l, 0.1, 0.7));
    // Holds at MOUNT_SCALE from the end of `related` onward.
    case 'success':
      return MOUNT_SCALE;
  }
}

function seatAdjustAt(phase: PhaseId, l: number): number {
  // 1 only in `success`: the front-drive assembled targets remap onto the resized mount only
  // once the mount itself has been resized (the beat before).
  if (phase !== 'success') return 0;
  return ease(ramp(l, 0, 0.7));
}

// Green (gear) / red (cover) glow window, expressed directly in `t`: rises over
// [GLOW_IN_START_T, GLOW_IN_END_T] (~23.5-24.5, just ahead of the resize/lift ramp above so the
// highlight cues the change before it visibly starts), holds at 1, falls over
// [GLOW_OUT_START_T, GLOW_OUT_END_T] (~28-29, fully faded by 29, before failure begins).
const GLOW_IN_START_T = 23.5;
const GLOW_IN_END_T = 24.5;
const GLOW_OUT_START_T = 28;
const GLOW_OUT_END_T = 29;

function greenAt(phase: PhaseId, t: number): number {
  if (phase !== 'change') return 0;
  // ramp() saturates outside its own range, so the min of the in- and out-ramps is the plateau
  // with no extra state.
  return Math.min(ramp(t, GLOW_IN_START_T, GLOW_IN_END_T), 1 - ramp(t, GLOW_OUT_START_T, GLOW_OUT_END_T));
}

function redAt(phase: PhaseId, l: number, t: number): number {
  switch (phase) {
    case 'change':
      // NEW: engineBackCover flags red in the same window the gear glows green (~24-29),
      // foreshadowing the mismatch that fails to seat in `failure`. Shares greenAt's exact ramp so
      // the two read as one synchronized beat.
      return Math.min(ramp(t, GLOW_IN_START_T, GLOW_IN_END_T), 1 - ramp(t, GLOW_OUT_START_T, GLOW_OUT_END_T));
    case 'failure':
      // In-then-hold: ramp() saturates at 1 past l=.8, which is the hold. Unchanged from before --
      // still local (`l`), not `t`, since this beat's timing is phase-relative to `failure`.
      return ramp(l, 0.6, 0.8);
    case 'second':
      // Out-then-hold, continuing from failure's end value of 1.
      return 1 - ramp(l, 0, 0.25);
    default:
      return 0;
  }
}

// Pre-highlight pulse: gear + engineBackCover glow orange from mid-explode until just after
// `change` begins (traverse ~6.06-18.18, change from ~18.18) -- expressed directly in `t`, not
// gated on phase at all, since a plain function of `t` is trivially continuous and
// scrub-reversible regardless of where the phase boundaries fall (the window intentionally
// crosses the traverse->change seam). Fully faded well before the green/red window opens at
// ~23.5.
const ORANGE_IN_START_T = 7.5;
const ORANGE_IN_END_T = 8;
const ORANGE_OUT_START_T = 18.5;
const ORANGE_OUT_END_T = 19;

function preHighlightOrangeAt(t: number): number {
  return Math.min(ramp(t, ORANGE_IN_START_T, ORANGE_IN_END_T), 1 - ramp(t, ORANGE_OUT_START_T, ORANGE_OUT_END_T));
}

function amberAt(phase: PhaseId, l: number): number {
  switch (phase) {
    case 'span':
      return ramp(l, 0.1, 0.55);
    case 'related':
      return 1 - ramp(l, 0.6, 0.9);
    default:
      return 0;
  }
}

function mountGreenAt(phase: PhaseId, l: number): number {
  switch (phase) {
    case 'span':
      return ramp(l, 0.6, 0.85);
    case 'related':
      return 1 - ramp(l, 0.75, 0.95);
    default:
      return 0;
  }
}

// Shares heroTraverseProgress with explode so the camera's approach to the canonical angle rides
// the same single curve, starting at the first pixel of scroll rather than waiting for `traverse`.
function azimuthBaseAt(phase: PhaseId, t: number): number {
  switch (phase) {
    case 'hero':
    case 'traverse':
      return lerp(HERO_AZIMUTH, CANONICAL_AZIMUTH, heroTraverseProgress(t));
    default:
      return CANONICAL_AZIMUTH;
  }
}

function elevationAt(phase: PhaseId, t: number): number {
  switch (phase) {
    case 'hero':
    case 'traverse':
      return lerp(HERO_ELEVATION, CANONICAL_ELEVATION, heroTraverseProgress(t));
    default:
      return CANONICAL_ELEVATION;
  }
}

// The idle rotation is time-based state in EngineScene; the frame only says how much of it the
// camera keeps. Fades out over a short leading fraction of the hero+traverse span so the idle
// orbit doesn't fight the scripted explode motion once it's underway -- starts fading at the
// first pixel of scroll (t just above 0), not at the top of `traverse`.
function idleWeightAt(phase: PhaseId, t: number): number {
  switch (phase) {
    case 'hero':
    case 'traverse':
      return 1 - ease(clamp01(t / (TRAVERSE_END_T * IDLE_FADE_FRACTION)));
    default:
      return 0;
  }
}

// Fraction of each push-in/pull-back phase's own local range the margin eases over at the top of
// that phase, instead of snapping instantly to the new flat value the moment the phase begins.
// ROOT CAUSE of the "sudden resize" bug at the change->failure and failure->second phase
// boundaries (reported at t=~36.3 and ~54.6, which sit right on top of the actual boundaries at
// t=36.36 and t=54.55): `marginAt` used to return a flat MARGIN_EXPLODED for `change` and a flat
// MARGIN_FAILURE for `failure` with no blending between them (same step at failure->second and
// related->success). The bounding sphere radius camera distance is fit to is already continuous
// across every one of these seams, so an instantaneous margin step is an instantaneous camera-
// distance step -- a visible pop/"sudden resize" with nothing else in the frame explaining it.
// Easing the margin in over the first slice of each of these phases' own local range (mirroring
// how hero/traverse already blend via heroTraverseProgress) removes the step while keeping every
// other beat identical.
const MARGIN_PUSH_FRACTION = 0.15;

// Shares heroTraverseProgress too: the camera pulls in from the wide hero margin to the tighter
// exploded-constellation margin over the same span the explode ramp and azimuth/elevation
// approach use, so the whole hero -> exploded journey reads as one continuous camera move
// starting at the first pixel of scroll instead of snapping at the traverse boundary.
function marginAt(phase: PhaseId, l: number, t: number): number {
  switch (phase) {
    case 'hero':
    case 'traverse':
      return lerp(MARGIN_ASSEMBLED, MARGIN_EXPLODED, heroTraverseProgress(t));
    case 'change':
      return MARGIN_EXPLODED;
    case 'failure':
      // Push in smoothly at the top of `failure` ("the camera zooms in") instead of snapping the
      // instant the phase starts.
      return lerp(MARGIN_EXPLODED, MARGIN_FAILURE, ease(ramp(l, 0, MARGIN_PUSH_FRACTION)));
    case 'second':
      // Symmetric pull-back at the top of `second` ("the camera zooms out").
      return lerp(MARGIN_FAILURE, MARGIN_EXPLODED, ease(ramp(l, 0, MARGIN_PUSH_FRACTION)));
    case 'span':
    case 'related':
      return MARGIN_EXPLODED;
    case 'success':
      // Same push-in shape as `failure`'s, for the same reason ("the camera zooms in; the engine
      // reassembles"). Not one of the two reported pops, but identical root cause -- fixed for
      // consistency rather than leaving a matching latent glitch at the related->success seam.
      return lerp(MARGIN_EXPLODED, MARGIN_FAILURE, ease(ramp(l, 0, MARGIN_PUSH_FRACTION)));
  }
}

// The fake ground-contact-shadow plane's opacity. Deliberately reuses explodeAt's exhaustive
// switch rather than duplicating a parallel one: `explode` already IS "how far the main body has
// separated from its assembled rest pose" (0 = assembled, 1 = fully exploded) for every phase --
// 1 at hero/traverse's start fading to 0 as heroTraverseProgress(t) runs (matching the "1 -
// heroTraverseProgress(t)" spec exactly), 0 held flat for change/second/span/related (all fully
// exploded), and a partial value in failure/success as the body reassembles (failure's residual
// front-drive gap doesn't stop the main body from reading as "reassembled enough" for a shadow;
// success's ramp reaches 0 = fully assembled, so the shadow returns to full). No separate case
// analysis needed since the shadow should track the same "how assembled is the body" curve.
function groundShadowAt(phase: PhaseId, l: number, t: number): number {
  return 1 - explodeAt(phase, l, t);
}

export function engineFrame(scene: SceneState): EngineFrame {
  const { phase, local: l, t } = scene;
  const id = phase.id;
  const drift = AZIMUTH_DRIFT * clamp01(t / 100);

  return {
    explode: explodeAt(id, l, t),
    frontDriveExplode: frontDriveExplodeAt(id, l, t),
    frontDriveScale: frontDriveScaleAt(id, t),
    mountScale: mountScaleAt(id, l),
    seatAdjust: seatAdjustAt(id, l),
    frontDriveLift: frontDriveLiftAt(id, t),
    green: greenAt(id, t),
    red: redAt(id, l, t),
    amber: amberAt(id, l),
    mountGreen: mountGreenAt(id, l),
    preHighlightOrange: preHighlightOrangeAt(t),
    azimuth: azimuthBaseAt(id, t) + drift,
    elevation: elevationAt(id, t),
    margin: marginAt(id, l, t),
    idleWeight: idleWeightAt(id, t),
    groundShadow: groundShadowAt(id, l, t)
  };
}
