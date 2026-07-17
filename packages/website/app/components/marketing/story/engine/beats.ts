// Pure SceneState -> EngineFrame choreography. No three imports: this module is the animation's
// contract, safe to import from React render paths and unit-reasoned-about without a WebGL
// context. Every quantity below is computed directly from (phase, local) — never from a
// previous call's output — so scrubbing the scroll timeline backwards is exactly as valid as
// scrubbing it forwards.
import { clamp01, ease, lerp, type PhaseId, ramp, type SceneState } from '../scene';

// --- Tunable constants -------------------------------------------------------------------
export const FRONT_SCALE = 1.15; // front-drive parts' scale at the top of `change`
export const MOUNT_SCALE = 1.15; // engineBlockFront's scale at the top of `related`
export const FAIL_STOP = 0.5; // residual front-drive explode in `failure` — the gap that won't close

export const HIGHLIGHT_GREEN = '#34d399';
export const HIGHLIGHT_RED = '#ef4444';
export const LINK_AMBER = '#d97706';

// The fit is bounding-sphere based, which already over-estimates the model's visual footprint —
// these margins stay modest so the engine reads generously while still never touching the frame.
export const MARGIN_ASSEMBLED = 1.12; // camera margin for hero / traverse / change
export const MARGIN_FAILURE = 1.06; // tighter margin from `failure` onward (auto push-in)

// Hero holds a flat, level presentation shot; `traverse` eases up into the canonical
// three-quarter technical-drawing angle that every later phase holds.
const HERO_AZIMUTH = 0;
const HERO_ELEVATION = 0;
export const CANONICAL_AZIMUTH = (35 * Math.PI) / 180;
export const CANONICAL_ELEVATION = (18 * Math.PI) / 180;

// Pure function of `t`, applied on top of the phase-held azimuth across the whole timeline —
// keeps parallax alive while scrubbing without breaking reversibility.
export const AZIMUTH_DRIFT = (18 * Math.PI) / 180;

// The hero's only time-based motion: one full turn every 45s, applied by EngineScene while
// setHeroIdle(true) and frozen under prefers-reduced-motion.
export const HERO_IDLE_RATE = (2 * Math.PI) / 45;

export interface EngineFrame {
  explode: number; // 0..1, all parts except front drive
  frontDriveExplode: number; // 0..1 (+FAIL_STOP residual in failure)
  frontDriveScale: number; // 1..FRONT_SCALE
  mountScale: number; // 1..MOUNT_SCALE
  seatAdjust: number; // 0..1 -- success-only: FD seats to mount-scaled anchors
  green: number;
  red: number;
  amber: number;
  mountGreen: number;
  azimuth: number;
  elevation: number;
  margin: number;
  idleWeight: number; // 0..1 -- how much of the accumulated hero idle rotation the camera keeps
}

function explodeAt(phase: PhaseId, l: number): number {
  switch (phase) {
    case 'hero':
      return 0;
    case 'traverse':
      return ease(l);
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

function frontDriveExplodeAt(phase: PhaseId, l: number): number {
  switch (phase) {
    case 'hero':
      return 0;
    case 'traverse':
      return ease(l); // tracks explode -- unison motion, no separate axis
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

function frontDriveScaleAt(phase: PhaseId, l: number): number {
  switch (phase) {
    case 'hero':
    case 'traverse':
      return 1;
    case 'change':
      return lerp(1, FRONT_SCALE, ramp(l, 0.15, 0.75));
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

function greenAt(phase: PhaseId, l: number): number {
  if (phase !== 'change') return 0;
  // In-hold-out plateau: rises over [.05,.2], holds at 1, falls over [.8,1]. ramp() saturates
  // outside its own range, so the min of the in- and out-ramps is the plateau with no extra state.
  return Math.min(ramp(l, 0.05, 0.2), 1 - ramp(l, 0.8, 1));
}

function redAt(phase: PhaseId, l: number): number {
  switch (phase) {
    case 'failure':
      // In-then-hold: ramp() saturates at 1 past l=.8, which is the hold.
      return ramp(l, 0.6, 0.8);
    case 'second':
      // Out-then-hold, continuing from failure's end value of 1.
      return 1 - ramp(l, 0, 0.25);
    default:
      return 0;
  }
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

function azimuthBaseAt(phase: PhaseId, l: number): number {
  switch (phase) {
    case 'hero':
      return HERO_AZIMUTH;
    case 'traverse':
      return lerp(HERO_AZIMUTH, CANONICAL_AZIMUTH, ease(l));
    default:
      return CANONICAL_AZIMUTH;
  }
}

function elevationAt(phase: PhaseId, l: number): number {
  switch (phase) {
    case 'hero':
      return HERO_ELEVATION;
    case 'traverse':
      return lerp(HERO_ELEVATION, CANONICAL_ELEVATION, ease(l));
    default:
      return CANONICAL_ELEVATION;
  }
}

// The idle rotation is time-based state in EngineScene; the frame only says how much of it the
// camera keeps. Weight 1 through the hero, eased out over the first third of `traverse` so the
// first scroll blends the idle offset away instead of snapping back to the base azimuth.
function idleWeightAt(phase: PhaseId, l: number): number {
  switch (phase) {
    case 'hero':
      return 1;
    case 'traverse':
      return 1 - ease(ramp(l, 0, 0.3));
    default:
      return 0;
  }
}

function marginAt(phase: PhaseId): number {
  switch (phase) {
    case 'hero':
    case 'traverse':
    case 'change':
      return MARGIN_ASSEMBLED;
    default:
      return MARGIN_FAILURE;
  }
}

export function engineFrame(scene: SceneState): EngineFrame {
  const { phase, local: l, t } = scene;
  const id = phase.id;
  const drift = AZIMUTH_DRIFT * clamp01(t / 100);

  return {
    explode: explodeAt(id, l),
    frontDriveExplode: frontDriveExplodeAt(id, l),
    frontDriveScale: frontDriveScaleAt(id, l),
    mountScale: mountScaleAt(id, l),
    seatAdjust: seatAdjustAt(id, l),
    green: greenAt(id, l),
    red: redAt(id, l),
    amber: amberAt(id, l),
    mountGreen: mountGreenAt(id, l),
    azimuth: azimuthBaseAt(id, l) + drift,
    elevation: elevationAt(id, l),
    margin: marginAt(id),
    idleWeight: idleWeightAt(id, l)
  };
}
