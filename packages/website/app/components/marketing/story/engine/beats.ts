// Pure SceneState -> EngineFrame choreography. No three imports: this module is the animation's
// contract, safe to import from React render paths and unit-reasoned-about without a WebGL
// context. Every quantity below is computed directly from (phase, local) — never from a
// previous call's output — so scrubbing the scroll timeline backwards is exactly as valid as
// scrubbing it forwards.
import { clamp01, ease, lerp, type PhaseId, ramp, type SceneState, TIMELINE } from '../scene';

// --- Tunable constants -------------------------------------------------------------------
export const FRONT_SCALE = 1.25; // gear's oversized scale while its mismatch beat is active
export const MOUNT_SCALE = 1.15; // FRONT_MOUNT's (engineBackCover's) scale at the top of `related`

// One to two steps deeper/more saturated than the original Tailwind-500 picks (emerald-400,
// red-500, blue-500, orange-500): under the bright RoomEnvironment + key + rim lighting rig, the
// highlight tint (see highlights.ts) reads over-bright and washed-out at those paler values -- the
// green especially read as a pale, minty tint rather than a vivid, saturated green. Deeper starting
// hues leave more headroom before ACESFilmicToneMapping's highlight shoulder desaturates them
// toward white once lit and tinted onto the metal.
export const HIGHLIGHT_GREEN = '#059669'; // the shared "resolved" color every mismatch part settles into, and the bounding box's tint
export const HIGHLIGHT_RED = '#dc2626';
export const HIGHLIGHT_BLUE = '#2563eb'; // the ring gear's own first-stage transition color
// A pre-highlight pulse on the gear + pistons + engineBackCover right around when the camera
// settles into its canonical framing (see CAMERA_SETTLE_T), fading directly into the mismatch
// beat's red -- a distinct hue so it doesn't read as the later resolution beat.
export const HIGHLIGHT_ORANGE = '#ea580c';

// The fit is bounding-sphere based, which already over-estimates the model's visual footprint —
// these margins stay modest so the engine reads generously while still never touching the frame.
// Margin is a scale-invariant padding ratio on the *current* bounding sphere (fitCameraToFrame
// recomputes camera distance from whatever sphere is live each frame), so a smaller margin always
// reads as "more zoomed in," never as cropping. Margin rides the explode curve directly (see
// marginAt): MARGIN_EXPLODED whenever the engine is fully exploded, MARGIN_ASSEMBLED whenever it
// is fully collapsed -- the hero, the FAILED_FIT hold (t43-48), and everything from t87 on all
// frame the assembled engine at exactly the same size; elsewhere only the live bounding-sphere
// radius moves the camera.
// Both margins below are the original values x0.8, a deliberate 25%-larger pass (smaller margin
// => camera sits closer => bigger apparent size, at a fixed FOV/frame size -- see the header
// comment above). MARGIN_ASSEMBLED landing under 1.0 (0.896) is a real change of character from
// the original >1.0 "guaranteed headroom" value: the assembled engine's silhouette sits closer to
// its own bounding sphere than the exploded constellation's does (it's compact and roughly
// isotropic, without the exploded view's big empty sphere corners), so this is the margin most
// likely to graze the frame edge on some viewport aspect ratios -- check the hero framing against
// real screenshots after this change, and back off toward 1.0 if it crops.
export const MARGIN_ASSEMBLED = 0.896; // camera margin for hero (idle turntable needs headroom)
export const MARGIN_EXPLODED = 0.68; // held whenever the engine is fully exploded
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
  mountScale: number; // 1..MOUNT_SCALE, back to 1 by t100; see mountScaleAt
  blue: number; // 0..1 -- the ring gear's first-stage orange->blue weight, ~t16-20, fading as `ringRed` ramps in
  ringRed: number; // 0..1 -- the ring gear's second-stage blue->red weight, ~t30-34; see mismatchRedAt
  red: number; // 0..1 -- engineBackCover's orange->red weight, in lockstep with the pistons and the gear's blue, ~t16-20; see pistonRedAt
  pistonRed: number; // 0..1 -- pistons' orange->red weight, in lockstep with the gear's blue, ~t16-20; see pistonRedAt
  finalGreen: number; // 0..1 -- gear + pistons + engineBackCover + mount all settle to this shared green, ~t60-72, then released over RETURN_TO_NORMAL_START_T..END_T (~t93-100)
  boxWeight: number; // 0..1 -- the translucent bounding-box's opacity while color is off the parts, ~t58-72 (peaks at 60)
  preHighlightOrange: number; // 0..1 -- orange pulse on gear + pistons + engineBackCover, ~t 7.5-20
  azimuth: number;
  elevation: number;
  margin: number;
  idleWeight: number; // 0..1 -- how much of the accumulated hero idle rotation the camera keeps
}

// The failed fit: mid-story, the engine attempts to reassemble around the oversized, mismatched
// gear -- it draws fully together over FAILED_FIT_COLLAPSE (demonstrating the parts no longer
// fitting), holds assembled through the heart of `failure`, then pulls back apart over
// FAILED_FIT_REEXPLODE so the resolution story (color loss, box, green) plays out against the
// exploded pose again.
const FAILED_FIT_COLLAPSE_START_T = 32;
const FAILED_FIT_COLLAPSE_END_T = 43;
const FAILED_FIT_REEXPLODE_START_T = 48;
const FAILED_FIT_REEXPLODE_END_T = 58;

// The final reassembly (exploded -> assembled) is expressed directly in `t`: FINAL_REASSEMBLY_
// START_T (83, inside `related`) to FINAL_REASSEMBLY_END_T (87, still inside `related`, well
// before `success` begins at ~96.97). Nothing about *position* moves again after 87 -- explode
// holds at 0 for the remainder of the timeline (no positional beat exists past t=87; the
// RETURN_TO_NORMAL window below only ever touches color/scale/idle weights).
const FINAL_REASSEMBLY_START_T = 83;
const FINAL_REASSEMBLY_END_T = 87;

// Pure function of `t`: ramps up with the camera settle (heroTraverseProgress), collapses and
// re-explodes across the FAILED_FIT windows mid-story, then collapses back to 0 for good over the
// FINAL_REASSEMBLY window. heroTraverseProgress is already pinned at 1 for every t past
// CAMERA_SETTLE_T, so multiplying it by the chained-ramp factor composes every stage of the curve
// without a phase switch; the chain is 1 in [settle, 32] and [58, 83], 0 in [43, 48] and [87, -].
function explodeAt(t: number): number {
  return (
    heroTraverseProgress(t) *
    (1 -
      ramp(t, FAILED_FIT_COLLAPSE_START_T, FAILED_FIT_COLLAPSE_END_T) +
      ramp(t, FAILED_FIT_REEXPLODE_START_T, FAILED_FIT_REEXPLODE_END_T) -
      ramp(t, FINAL_REASSEMBLY_START_T, FINAL_REASSEMBLY_END_T))
  );
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
//   t 16-20    the gear turns orange -> blue; the pistons and engineBackCover go straight
//              orange -> red on the same window (see pistonRedAt), and the orange pre-highlight
//              fades out underneath, crossfading directly into the arriving blue/red
//   t 22-27    the gear grows to FRONT_SCALE as its own beat, after the color story has landed
//   t 30-34    the gear (only) goes blue -> red, resolving to the same red the pistons and
//              engineBackCover already locked in at t20
//   t 32-43    FAILED_FIT: the engine draws fully back together around the oversized red gear --
//              the attempted reassembly that demonstrates the parts no longer fit (see explodeAt)
//   t 48-58    FAILED_FIT: the engine pulls back apart into the exploded view
//   t 46-60    every highlighted part fades to no color at all and the gear shrinks back to 1x
//   t 58-60    a translucent green bounding box fades in around the ring/pistons/back plate, only
//              once the re-explode has finished
//   t 60-62    the box holds at full opacity
//   t 62-64    the box fades back out, as fast as it appeared (see boxWeightAt)
//   t 60-72    gear + pistons + engineBackCover + the mount all separately fade up to the same
//              shared green (see finalGreenAt) -- this window overlaps but no longer drives the
//              box's fade-out; the two are deliberately decoupled (see boxWeightAt's comment)
//   t 72-83    the gear grows back to FRONT_SCALE
//   t 83-87    the whole engine reassembles (see explodeAt above)
//   t 93-100   RETURN_TO_NORMAL: every mismatch part loses its green, the gear and mount ease back
//              to 1x scale, and the idle-orbit weight fades back in -- the engine ends this window
//              looking exactly as it does at the top of `hero`, slowly turning
//
// None of these are undone by anything earlier than RETURN_TO_NORMAL_START_T -- once a stage locks
// in, it holds until that final release window. RETURN_TO_NORMAL (t93-100) is the one deliberate
// exception: it is a shared subtractive ramp composed into finalGreen, scaleWeight, and mountScale
// (and an additive one composed into idleWeight) exactly the way every other multi-stage beat in
// this file composes ramps, undoing the "permanent" mismatch-story state on purpose so the engine
// can end at rest.
const ORANGE_IN_START_T = 7.5;
const ORANGE_IN_END_T = 8;
const ORANGE_OUT_START_T = 16;
const ORANGE_OUT_END_T = 20;
const RING_BLUE_START_T = 16;
const RING_BLUE_END_T = 20;
// The gear's oversize beat runs on its own window, just after the color story lands: the gear
// turns blue over t16-20, then grows to FRONT_SCALE over t22-27 as a separate, readable beat.
const RING_RESIZE_START_T = 22;
const RING_RESIZE_END_T = 27;
const MISMATCH_RED_START_T = 30;
const MISMATCH_RED_END_T = 34;
const COLOR_LOSS_START_T = 46;
const COLOR_LOSS_END_T = 60;
const RESOLVE_GREEN_START_T = 60;
const RESOLVE_GREEN_END_T = 72;
const RING_REGROW_START_T = 72;
const RING_REGROW_END_T = 83;

// The final release: over this window (inside `success`, t 96.97-100, but expressed purely in `t`
// like everything else in this file) every mismatch part loses its green, the gear and mount ease
// back to 1x, and the idle-orbit weight fades back in -- the engine ends the timeline exactly as
// it began it, slowly turning. Exported so EngineStage.tsx can gate the idle-spin accumulator on
// the same window.
export const RETURN_TO_NORMAL_START_T = 93;
export const RETURN_TO_NORMAL_END_T = 100;

function preHighlightOrangeAt(t: number): number {
  return Math.min(ramp(t, ORANGE_IN_START_T, ORANGE_IN_END_T), 1 - ramp(t, ORANGE_OUT_START_T, ORANGE_OUT_END_T));
}

// The gear's first-stage color: ramps in over RING_BLUE_START_T..END_T (its resize follows on
// RING_RESIZE_START_T..END_T as a separate beat), then fades back out over
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
// red the moment the ring turns blue (RING_BLUE_START_T..END_T), not in lockstep with
// the ring's own later blue -> red stage. Holds until COLOR_LOSS_START_T, then fades out with
// everything else.
function pistonRedAt(t: number): number {
  return ramp(t, RING_BLUE_START_T, RING_BLUE_END_T) - ramp(t, COLOR_LOSS_START_T, COLOR_LOSS_END_T);
}

// The shared "resolved" color every mismatch part (gear, pistons, engineBackCover) and the mount
// settle into together. Ramps in once, holds through the whole mismatch story, then releases over
// RETURN_TO_NORMAL_START_T..END_T as the ending brings every part back to its natural color -- the
// one subtractive exception to "never undone" in this file; see the header comment.
function finalGreenAt(t: number): number {
  return (
    ramp(t, RESOLVE_GREEN_START_T, RESOLVE_GREEN_END_T) - ramp(t, RETURN_TO_NORMAL_START_T, RETURN_TO_NORMAL_END_T)
  );
}

// The translucent bounding box: fades in only once the FAILED_FIT re-explode has finished (t58,
// well after color has mostly drained off the parts), peaks at t60, holds through t62, then fades
// back out over its own BOX_OUT window -- as fast as it appeared (same 2-unit width as
// BOX_IN_START_T..END_T). This is deliberately decoupled from RESOLVE_GREEN_START_T..END_T (t60-72,
// which still separately drives the parts' shared-green fade-in, see finalGreenAt above): an
// earlier version reused the RESOLVE_GREEN window for the box's fade-out too, which made the box
// linger, slowly dissolving over 12 units in lockstep with the green ramp, rather than snapping
// away the way it snapped in.
//   t:     58   60   62   64
//   box:   in-> peak hold out->gone
const BOX_IN_START_T = 58;
const BOX_IN_END_T = 60;
const BOX_OUT_START_T = 62;
const BOX_OUT_END_T = 64;
function boxWeightAt(t: number): number {
  return ramp(t, BOX_IN_START_T, BOX_IN_END_T) - ramp(t, BOX_OUT_START_T, BOX_OUT_END_T);
}

// The gear's own oversize weight: grows to FRONT_SCALE on its own window just after the first
// color stage lands (RING_RESIZE_START_T..END_T), shrinks back to 1x during the color-loss window
// (in lockstep with the box appearing), then grows back to FRONT_SCALE once the parts have
// resolved to green, then eases back to 1x for good over RETURN_TO_NORMAL_START_T..END_T.
// Composed as four chained ramps rather than a single curve, the same additive/subtractive
// technique `explodeAt` and the rest of this file already use for multi-stage `t`-only beats.
function scaleWeightAt(t: number): number {
  return (
    ramp(t, RING_RESIZE_START_T, RING_RESIZE_END_T) -
    ramp(t, COLOR_LOSS_START_T, COLOR_LOSS_END_T) +
    ramp(t, RING_REGROW_START_T, RING_REGROW_END_T) -
    ramp(t, RETURN_TO_NORMAL_START_T, RETURN_TO_NORMAL_END_T)
  );
}

function frontDriveScaleAt(t: number): number {
  return lerp(1, FRONT_SCALE, scaleWeightAt(t));
}

// The window `related` grows the mount across, derived from TIMELINE rather than hardcoded so it
// stays correct if the phase geometry (scrollVh weights) ever changes: local 0.1..0.7 of `related`'s
// own [start, end) span.
const RELATED_PHASE = TIMELINE.find((phase) => phase.id === 'related')!;
const MOUNT_GROW_START_T = lerp(RELATED_PHASE.start, RELATED_PHASE.end, 0.1);
const MOUNT_GROW_END_T = lerp(RELATED_PHASE.start, RELATED_PHASE.end, 0.7);

// The mount's own oversize weight: grows across MOUNT_GROW_START_T..END_T (the first 0.1..0.7 of
// `related`), holds at 1 through the rest of the mismatch story, then eases back to 1x in lockstep
// with the gear (frontDriveScale) and the green release (finalGreen) over
// RETURN_TO_NORMAL_START_T..END_T -- the same additive/subtractive pure-`t` composition as
// scaleWeightAt, not a phase switch.
function mountScaleAt(t: number): number {
  const weight =
    ramp(t, MOUNT_GROW_START_T, MOUNT_GROW_END_T) - ramp(t, RETURN_TO_NORMAL_START_T, RETURN_TO_NORMAL_END_T);
  return lerp(1, MOUNT_SCALE, weight);
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
// first pixel of scroll (t just above 0), not at the top of `traverse`. Fades back in over
// RETURN_TO_NORMAL_START_T..END_T so the ending resumes the same idle turntable the hero opened
// with -- continuous across the whole timeline (0 through most of the mismatch story, ramping to 1
// by t100).
function idleWeightAt(phase: PhaseId, t: number): number {
  switch (phase) {
    case 'hero':
    case 'traverse':
      return 1 - ease(clamp01(t / (TRAVERSE_END_T * IDLE_FADE_FRACTION)));
    default:
      return ramp(t, RETURN_TO_NORMAL_START_T, RETURN_TO_NORMAL_END_T);
  }
}

// Shares heroTraverseProgress too: the camera pulls in from the wide hero margin to the tighter
// exploded-constellation margin over the same span the explode ramp and azimuth/elevation
// approach use, so the whole hero -> exploded journey reads as one continuous camera move
// starting at the first pixel of scroll instead of snapping at the traverse boundary. Holds flat
// at MARGIN_EXPLODED through the whole exploded/mismatch story (fitCameraToFrame's own
// radius-based distance already handles the reassembly's size change; margin itself stays
// constant), then eases back out to MARGIN_ASSEMBLED over the RETURN_TO_NORMAL window so the
// ending lands at exactly the hero's framing -- without this, the assembled engine at t100 reads
// noticeably larger than the identical engine the hero opened with.
// Margin rides explodeAt directly rather than any phase switch: every collapse -- the hero pose,
// the FAILED_FIT hold, the final reassembly -- frames the assembled engine at exactly
// MARGIN_ASSEMBLED, and every fully exploded stretch holds MARGIN_EXPLODED, with the blends
// riding the same ramps that move the parts.
function marginAt(t: number): number {
  return lerp(MARGIN_ASSEMBLED, MARGIN_EXPLODED, explodeAt(t));
}

export function engineFrame(scene: SceneState): EngineFrame {
  const { phase, t } = scene;
  const id = phase.id;
  const drift = AZIMUTH_DRIFT * clamp01(t / 100);

  return {
    explode: explodeAt(t),
    frontDriveExplode: frontDriveExplodeAt(t),
    frontDriveScale: frontDriveScaleAt(t),
    mountScale: mountScaleAt(t),
    blue: ringBlueAt(t),
    ringRed: mismatchRedAt(t),
    red: pistonRedAt(t),
    pistonRed: pistonRedAt(t),
    finalGreen: finalGreenAt(t),
    boxWeight: boxWeightAt(t),
    preHighlightOrange: preHighlightOrangeAt(t),
    azimuth: azimuthBaseAt(id, t) + drift,
    elevation: elevationAt(id, t),
    margin: marginAt(t),
    idleWeight: idleWeightAt(id, t)
  };
}
