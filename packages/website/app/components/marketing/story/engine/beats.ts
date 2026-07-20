// Pure SceneState -> EngineFrame choreography. No three imports: this module is the animation's
// contract, safe to import from React render paths and unit-reasoned-about without a WebGL
// context. Every quantity below is computed directly from (phase, local) — never from a
// previous call's output — so scrubbing the scroll timeline backwards is exactly as valid as
// scrubbing it forwards.
import { clamp01, ease, lerp, type PhaseId, ramp, type SceneState, TIMELINE } from '../scene';

// --- Tunable constants -------------------------------------------------------------------
export const FRONT_SCALE = 1.25; // gear's oversized scale while its mismatch beat is active
export const MOUNT_SCALE = 1.15; // FRONT_MOUNT's (engineBackCover's) scale at the top of `related`

export const HIGHLIGHT_GREEN = '#34d399'; // the shared "resolved" color every mismatch part settles into, and the bounding box's tint
export const HIGHLIGHT_RED = '#ef4444';
export const HIGHLIGHT_BLUE = '#3b82f6'; // the ring gear's own first-stage transition color
// A pre-highlight pulse on the gear + pistons + engineBackCover right around when the camera
// settles into its canonical framing (see CAMERA_SETTLE_T), fading directly into the mismatch
// beat's red -- a distinct hue so it doesn't read as the later resolution beat.
export const HIGHLIGHT_ORANGE = '#f97316';

// The fit is bounding-sphere based, which already over-estimates the model's visual footprint —
// these margins stay modest so the engine reads generously while still never touching the frame.
// Margin is a scale-invariant padding ratio on the *current* bounding sphere (fitCameraToFrame
// recomputes camera distance from whatever sphere is live each frame), so a smaller margin always
// reads as "more zoomed in," never as cropping. MARGIN_EXPLODED holds flat for the entire
// exploded-view portion of the timeline (see marginAt) -- the apparent size of the constellation
// never changes on its own; only the live bounding-sphere radius (which shrinks during the final
// reassembly) moves the camera.
// Both margins below are the original values x0.8, a deliberate 25%-larger pass (smaller margin
// => camera sits closer => bigger apparent size, at a fixed FOV/frame size -- see the header
// comment above). MARGIN_ASSEMBLED landing under 1.0 (0.896) is a real change of character from
// the original >1.0 "guaranteed headroom" value: the assembled engine's silhouette sits closer to
// its own bounding sphere than the exploded constellation's does (it's compact and roughly
// isotropic, without the exploded view's big empty sphere corners), so this is the margin most
// likely to graze the frame edge on some viewport aspect ratios -- check the hero framing against
// real screenshots after this change, and back off toward 1.0 if it crops.
export const MARGIN_ASSEMBLED = 0.896; // camera margin for hero (idle turntable needs headroom)
export const MARGIN_EXPLODED = 0.68; // held flat from the end of `traverse` onward
// -- the sphere fit overestimates the constellation's actual silhouette (parts explode along
// specific directions, not isotropically, so the bounding sphere has empty corners no geometry
// ever reaches), so this sits below 1.0 to compensate and still lands the visible cluster close
// to the frame edge; see the header comment above and iterate against real screenshots, not the
// number in isolation.

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
  frontDriveExplode: number; // 0..1 -- tracks `explode` exactly (unison motion, no separate stall)
  frontDriveScale: number; // 1..FRONT_SCALE -- the gear's own oversize beat; see scaleWeightAt
  mountScale: number; // 1..MOUNT_SCALE
  seatAdjust: number; // 0..1 -- success-only: FD seats to mount-scaled anchors
  blue: number; // 0..1 -- the ring gear's first-stage orange->blue weight, ~t16-24, fading as `ringRed` ramps in
  ringRed: number; // 0..1 -- the ring gear's second-stage blue->red weight, ~t28-41; see mismatchRedAt
  red: number; // 0..1 -- engineBackCover's orange->red weight, in lockstep with the pistons and the gear's resize/blue, ~t16-24; see pistonRedAt
  pistonRed: number; // 0..1 -- pistons' orange->red weight, in lockstep with the gear's resize/blue, ~t16-24; see pistonRedAt
  finalGreen: number; // 0..1 -- gear + pistons + engineBackCover + mount all settle to this shared green, ~t60-72, permanent after
  boxWeight: number; // 0..1 -- the translucent bounding-box's opacity while color is off the parts, ~t46-72 (peaks at 60)
  preHighlightOrange: number; // 0..1 -- orange pulse on gear + pistons + engineBackCover, ~t 7.5-28
  azimuth: number;
  elevation: number;
  margin: number;
  idleWeight: number; // 0..1 -- how much of the accumulated hero idle rotation the camera keeps
  groundShadow: number; // 0..1 -- fake contact-shadow plane opacity; see groundShadowAt below
}

// The final reassembly (exploded -> assembled) is expressed directly in `t`: FINAL_REASSEMBLY_
// START_T (83, inside `related`) to FINAL_REASSEMBLY_END_T (87, still inside `related`, well
// before `success` begins at ~96.97). Nothing about position moves again after 87 -- explode holds
// at 0 for the remainder of the timeline. Everything from CAMERA_SETTLE_T (12.3) through 83 stays
// fully exploded; the color/scale/box beats between 16 and 83 all play out against that held
// exploded pose, not against any intermediate collapse.
const FINAL_REASSEMBLY_START_T = 83;
const FINAL_REASSEMBLY_END_T = 87;

// Pure function of `t`: ramps up with the camera settle (heroTraverseProgress), holds flat at 1
// through the whole mismatch story (color changes, box, scale cycling -- none of them move
// anything), then collapses back to 0 over the FINAL_REASSEMBLY window. heroTraverseProgress is
// already pinned at 1 for every t past CAMERA_SETTLE_T, so multiplying it by the (1 - reassembly
// ramp) factor composes both ends of the curve without a phase switch.
function explodeAt(t: number): number {
  return heroTraverseProgress(t) * (1 - ramp(t, FINAL_REASSEMBLY_START_T, FINAL_REASSEMBLY_END_T));
}

// Always tracks explodeAt exactly -- the gear no longer stalls at a partial, unclosed gap; it
// moves in unison with the rest of the body for both the initial explode and the final reassembly.
function frontDriveExplodeAt(t: number): number {
  return explodeAt(t);
}

// --- The mismatch story: color, scale, and the bounding box -----------------------------------
// Every beat below is a pure function of `t` (never gated on phase), so each is pinned to an exact
// scroll position regardless of which phase boundary it happens to fall in:
//
//   t 7.5-8    orange pre-highlight ramps in on gear + pistons + engineBackCover
//   t 16-24    the gear turns orange -> blue and grows to FRONT_SCALE; the pistons and
//              engineBackCover go straight orange -> red on the same window (see pistonRedAt)
//   t 20-28    the orange pre-highlight fades out on the gear, crossfading into the window below
//              rather than into the gear's intermediate blue
//   t 28-41    the gear (only) goes blue -> red, resolving to the same red the pistons and
//              engineBackCover already locked in at t24
//   t 46-60    every highlighted part fades to no color at all, the gear shrinks back to 1x,
//              and a translucent green bounding box fades in around the ring/pistons/back plate
//   t 60-72    the bounding box fades back out as gear + pistons + engineBackCover + the mount
//              all fade up to the same shared green -- permanent from here on
//   t 72-83    the gear grows back to FRONT_SCALE
//   t 83-87    the whole engine reassembles (see explodeAt above)
//
// None of these are undone by anything later -- once a stage locks in, it holds.
const ORANGE_IN_START_T = 7.5;
const ORANGE_IN_END_T = 8;
const ORANGE_OUT_START_T = 20;
const ORANGE_OUT_END_T = 28;
const RING_BLUE_START_T = 16;
const RING_BLUE_END_T = 24;
const MISMATCH_RED_START_T = 28;
const MISMATCH_RED_END_T = 41;
const COLOR_LOSS_START_T = 46;
const COLOR_LOSS_END_T = 60;
const RESOLVE_GREEN_START_T = 60;
const RESOLVE_GREEN_END_T = 72;
const RING_REGROW_START_T = 72;
const RING_REGROW_END_T = 83;

function preHighlightOrangeAt(t: number): number {
  return Math.min(ramp(t, ORANGE_IN_START_T, ORANGE_IN_END_T), 1 - ramp(t, ORANGE_OUT_START_T, ORANGE_OUT_END_T));
}

// The gear's first-stage color: ramps in with its resize, then fades back out over
// MISMATCH_RED_START_T..END_T as `mismatchRedAt` (below) ramps in -- a direct blue -> red
// crossfade, not a snap.
function ringBlueAt(t: number): number {
  return ramp(t, RING_BLUE_START_T, RING_BLUE_END_T) - ramp(t, MISMATCH_RED_START_T, MISMATCH_RED_END_T);
}

// The gear's own second stage (ringRed): ramps in over MISMATCH_RED_START_T..END_T, holds until
// COLOR_LOSS_START_T, then fades out over COLOR_LOSS_START_T..END_T as every highlight goes dark
// ahead of the bounding box / resolve-green beats.
function mismatchRedAt(t: number): number {
  return ramp(t, MISMATCH_RED_START_T, MISMATCH_RED_END_T) - ramp(t, COLOR_LOSS_START_T, COLOR_LOSS_END_T);
}

// Shared by the pistons (pistonRed) and engineBackCover (red): both go straight from orange to
// red the moment the ring grows and turns blue (RING_BLUE_START_T..END_T), not in lockstep with
// the ring's own later blue -> red stage. Holds until COLOR_LOSS_START_T, then fades out with
// everything else.
function pistonRedAt(t: number): number {
  return ramp(t, RING_BLUE_START_T, RING_BLUE_END_T) - ramp(t, COLOR_LOSS_START_T, COLOR_LOSS_END_T);
}

// The shared "resolved" color every mismatch part (gear, pistons, engineBackCover) and the mount
// settle into together. Ramps in once, holds permanently -- never undone.
function finalGreenAt(t: number): number {
  return ramp(t, RESOLVE_GREEN_START_T, RESOLVE_GREEN_END_T);
}

// The translucent bounding box: fades in exactly as color fades off the parts (COLOR_LOSS
// window), peaks at t60, then fades back out exactly as the shared green fades in (RESOLVE_GREEN
// window) -- the box and the green highlight are never both fully on, they hand off at t60.
function boxWeightAt(t: number): number {
  return ramp(t, COLOR_LOSS_START_T, COLOR_LOSS_END_T) - ramp(t, RESOLVE_GREEN_START_T, RESOLVE_GREEN_END_T);
}

// The gear's own oversize weight: grows to FRONT_SCALE alongside its first color stage, shrinks
// back to 1x during the color-loss window (in lockstep with the box appearing), then grows back
// to FRONT_SCALE once the parts have resolved to green. Composed as three chained ramps rather
// than a single curve, the same additive/subtractive technique `explodeAt` and the rest of this
// file already use for multi-stage `t`-only beats.
function scaleWeightAt(t: number): number {
  return (
    ramp(t, RING_BLUE_START_T, RING_BLUE_END_T) -
    ramp(t, COLOR_LOSS_START_T, COLOR_LOSS_END_T) +
    ramp(t, RING_REGROW_START_T, RING_REGROW_END_T)
  );
}

function frontDriveScaleAt(t: number): number {
  return lerp(1, FRONT_SCALE, scaleWeightAt(t));
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

// Shares heroTraverseProgress too: the camera pulls in from the wide hero margin to the tighter
// exploded-constellation margin over the same span the explode ramp and azimuth/elevation
// approach use, so the whole hero -> exploded journey reads as one continuous camera move
// starting at the first pixel of scroll instead of snapping at the traverse boundary. Holds flat
// at MARGIN_EXPLODED for every phase after `traverse` -- the exploded view's apparent size never
// changes again for the rest of the timeline (fitCameraToFrame's own radius-based distance
// already handles the later reassembly's size change; margin itself stays constant).
function marginAt(phase: PhaseId, t: number): number {
  switch (phase) {
    case 'hero':
    case 'traverse':
      return lerp(MARGIN_ASSEMBLED, MARGIN_EXPLODED, heroTraverseProgress(t));
    default:
      return MARGIN_EXPLODED;
  }
}

// The fake ground-contact-shadow plane's opacity. Mirrors explodeAt exactly: 1 (assembled) at
// t=0, fading to 0 as the initial explode ramps in, held at 0 through the whole mismatch story
// (still fully exploded), then rising back to 1 over the FINAL_REASSEMBLY window as the body
// reassembles.
function groundShadowAt(t: number): number {
  return 1 - explodeAt(t);
}

export function engineFrame(scene: SceneState): EngineFrame {
  const { phase, local: l, t } = scene;
  const id = phase.id;
  const drift = AZIMUTH_DRIFT * clamp01(t / 100);

  return {
    explode: explodeAt(t),
    frontDriveExplode: frontDriveExplodeAt(t),
    frontDriveScale: frontDriveScaleAt(t),
    mountScale: mountScaleAt(id, l),
    seatAdjust: seatAdjustAt(id, l),
    blue: ringBlueAt(t),
    ringRed: mismatchRedAt(t),
    red: pistonRedAt(t),
    pistonRed: pistonRedAt(t),
    finalGreen: finalGreenAt(t),
    boxWeight: boxWeightAt(t),
    preHighlightOrange: preHighlightOrangeAt(t),
    azimuth: azimuthBaseAt(id, t) + drift,
    elevation: elevationAt(id, t),
    margin: marginAt(id, t),
    idleWeight: idleWeightAt(id, t),
    groundShadow: groundShadowAt(t)
  };
}
