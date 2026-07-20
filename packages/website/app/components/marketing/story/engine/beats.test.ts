import { describe, expect, it } from 'vitest';
import { clamp01, deriveScene, ease, ramp, TIMELINE } from '../scene';
import {
  AZIMUTH_DRIFT,
  CANONICAL_AZIMUTH,
  CANONICAL_ELEVATION,
  engineFrame,
  FRONT_SCALE,
  MARGIN_EXPLODED,
  MOUNT_SCALE
} from './beats';

// Authoritative timeline breakpoints, taken from beats.ts's own header comment (t 7.5-8 ... t
// 83-87). These are deliberately re-declared here (not imported) since beats.ts doesn't export
// its internal `*_START_T`/`*_END_T` constants -- they're the contract under test.
const CAMERA_SETTLE_T = 12.3;
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
const FINAL_REASSEMBLY_START_T = 83;
const FINAL_REASSEMBLY_END_T = 87;

const frameAt = (t: number) => engineFrame(deriveScene(t));

const traversePhase = TIMELINE.find((phase) => phase.id === 'traverse')!;
const relatedPhase = TIMELINE.find((phase) => phase.id === 'related')!;
const successPhase = TIMELINE.find((phase) => phase.id === 'success')!;

const tAtLocal = (phase: { start: number; end: number }, local: number) =>
  phase.start + local * (phase.end - phase.start);

describe('preHighlightOrange', () => {
  it('is 0 before the in-ramp starts', () => {
    expect(frameAt(ORANGE_IN_START_T).preHighlightOrange).toBe(0);
  });

  it('is 1 across the held plateau', () => {
    expect(frameAt(ORANGE_IN_END_T).preHighlightOrange).toBe(1);
    expect(frameAt(15).preHighlightOrange).toBe(1);
    expect(frameAt(ORANGE_OUT_START_T).preHighlightOrange).toBe(1);
  });

  it('is 0 once the out-ramp completes, and stays 0', () => {
    expect(frameAt(ORANGE_OUT_END_T).preHighlightOrange).toBe(0);
    expect(frameAt(50).preHighlightOrange).toBe(0);
    expect(frameAt(100).preHighlightOrange).toBe(0);
  });

  it('ramps linearly mid-window', () => {
    const mid = (ORANGE_IN_START_T + ORANGE_IN_END_T) / 2;
    expect(frameAt(mid).preHighlightOrange).toBeCloseTo(0.5, 10);
  });
});

describe('blue (ring gear first stage)', () => {
  it('is 0 before the ring-blue window starts', () => {
    expect(frameAt(RING_BLUE_START_T).blue).toBe(0);
  });

  it('is 1 from t=24 through t=28', () => {
    expect(frameAt(RING_BLUE_END_T).blue).toBe(1);
    expect(frameAt(26).blue).toBe(1);
    expect(frameAt(MISMATCH_RED_START_T).blue).toBe(1);
  });

  it('is 0 at t>=41', () => {
    expect(frameAt(MISMATCH_RED_END_T).blue).toBe(0);
    expect(frameAt(45).blue).toBe(0);
    expect(frameAt(100).blue).toBe(0);
  });
});

describe('ringRed (ring gear second stage)', () => {
  it('is 0 before the mismatch-red window starts', () => {
    expect(frameAt(MISMATCH_RED_START_T).ringRed).toBe(0);
  });

  it('is 1 at t=41..46', () => {
    expect(frameAt(MISMATCH_RED_END_T).ringRed).toBe(1);
    expect(frameAt(COLOR_LOSS_START_T).ringRed).toBe(1);
  });

  it('is 0 at t>=60, and stays 0', () => {
    expect(frameAt(COLOR_LOSS_END_T).ringRed).toBe(0);
    expect(frameAt(100).ringRed).toBe(0);
  });
});

describe('red / pistonRed (shared pistonRedAt)', () => {
  it('are equal for every t (they deliberately share pistonRedAt)', () => {
    for (let t = 0; t <= 100; t += 0.5) {
      const frame = frameAt(t);
      expect(frame.red).toBe(frame.pistonRed);
    }
  });

  it('ramps in with the ring-blue window, not the ring-red window', () => {
    expect(frameAt(RING_BLUE_START_T).red).toBe(0);
    expect(frameAt(RING_BLUE_END_T).red).toBe(1);
    expect(frameAt(COLOR_LOSS_START_T).red).toBe(1);
  });

  it('is 0 at t>=60, and stays 0', () => {
    expect(frameAt(COLOR_LOSS_END_T).red).toBe(0);
    expect(frameAt(100).red).toBe(0);
  });
});

describe('finalGreen', () => {
  it('is 0 at t<=60', () => {
    expect(frameAt(RESOLVE_GREEN_START_T).finalGreen).toBe(0);
    expect(frameAt(0).finalGreen).toBe(0);
  });

  it('is 1 at t>=72, and holds through t=100', () => {
    expect(frameAt(RESOLVE_GREEN_END_T).finalGreen).toBe(1);
    expect(frameAt(80).finalGreen).toBe(1);
    expect(frameAt(100).finalGreen).toBe(1);
  });

  it('ramps linearly mid-window', () => {
    const mid = (RESOLVE_GREEN_START_T + RESOLVE_GREEN_END_T) / 2;
    expect(frameAt(mid).finalGreen).toBeCloseTo(0.5, 10);
  });
});

describe('boxWeight', () => {
  it('is 0 at t<=46', () => {
    expect(frameAt(COLOR_LOSS_START_T).boxWeight).toBe(0);
    expect(frameAt(0).boxWeight).toBe(0);
  });

  it('peaks at exactly 1 at t=60', () => {
    expect(frameAt(COLOR_LOSS_END_T).boxWeight).toBe(1);
  });

  it('is 0 at t>=72', () => {
    expect(frameAt(RING_REGROW_START_T).boxWeight).toBe(0);
    expect(frameAt(100).boxWeight).toBe(0);
  });

  it('never exceeds 1 at any sampled t (color-loss and resolve-green windows hand off cleanly at 60)', () => {
    for (let t = 0; t <= 100; t += 0.5) {
      expect(frameAt(t).boxWeight).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe('frontDriveScale', () => {
  it('cycles 1 -> 1.25 (t24-46) -> 1 (t60-72) -> 1.25 (t>=83)', () => {
    expect(frameAt(0).frontDriveScale).toBe(1);
    expect(frameAt(RING_BLUE_END_T).frontDriveScale).toBe(FRONT_SCALE);
    expect(frameAt(COLOR_LOSS_START_T).frontDriveScale).toBe(FRONT_SCALE);
    expect(frameAt(RESOLVE_GREEN_START_T).frontDriveScale).toBe(1);
    expect(frameAt(RING_REGROW_START_T).frontDriveScale).toBe(1);
    expect(frameAt(RING_REGROW_END_T).frontDriveScale).toBe(FRONT_SCALE);
    expect(frameAt(100).frontDriveScale).toBe(FRONT_SCALE);
  });

  it('shrinks back to 1x during the color-loss window', () => {
    expect(frameAt(COLOR_LOSS_END_T).frontDriveScale).toBe(1);
  });
});

describe('explode / frontDriveExplode', () => {
  it('frontDriveExplode tracks explode exactly at every t', () => {
    for (let t = 0; t <= 100; t += 0.5) {
      const frame = frameAt(t);
      expect(frame.frontDriveExplode).toBe(frame.explode);
    }
  });

  it('is 0 at t=0', () => {
    expect(frameAt(0).explode).toBe(0);
  });

  it('is 1 from CAMERA_SETTLE_T through t=83', () => {
    expect(frameAt(CAMERA_SETTLE_T).explode).toBe(1);
    expect(frameAt(50).explode).toBe(1);
    expect(frameAt(FINAL_REASSEMBLY_START_T).explode).toBe(1);
  });

  it('collapses to 0 by t=87 and stays there', () => {
    expect(frameAt(FINAL_REASSEMBLY_END_T).explode).toBe(0);
    expect(frameAt(100).explode).toBe(0);
  });
});

describe('camera settle: margin, azimuth, elevation', () => {
  it('margin settles to MARGIN_EXPLODED by CAMERA_SETTLE_T and holds', () => {
    expect(frameAt(CAMERA_SETTLE_T).margin).toBeCloseTo(MARGIN_EXPLODED, 10);
    expect(frameAt(50).margin).toBe(MARGIN_EXPLODED);
    expect(frameAt(100).margin).toBe(MARGIN_EXPLODED);
  });

  it('elevation settles to CANONICAL_ELEVATION by CAMERA_SETTLE_T and holds', () => {
    expect(frameAt(CAMERA_SETTLE_T).elevation).toBeCloseTo(CANONICAL_ELEVATION, 10);
    expect(frameAt(50).elevation).toBe(CANONICAL_ELEVATION);
    expect(frameAt(100).elevation).toBe(CANONICAL_ELEVATION);
  });

  it('azimuth settles to CANONICAL_AZIMUTH plus a linear drift term (AZIMUTH_DRIFT * t/100)', () => {
    for (const t of [CAMERA_SETTLE_T, 30, 60, 90, 100]) {
      const expected = CANONICAL_AZIMUTH + AZIMUTH_DRIFT * clamp01(t / 100);
      expect(frameAt(t).azimuth).toBeCloseTo(expected, 10);
    }
  });
});

describe('idleWeight', () => {
  it('is 1 at t=0', () => {
    expect(frameAt(0).idleWeight).toBe(1);
  });

  it('is 0 by the top of `change`, and stays 0', () => {
    const changePhase = TIMELINE.find((phase) => phase.id === 'change')!;
    expect(frameAt(changePhase.start).idleWeight).toBe(0);
    expect(frameAt(50).idleWeight).toBe(0);
    expect(frameAt(100).idleWeight).toBe(0);
  });

  it('fades out within the leading fraction of hero+traverse, well before traverse ends', () => {
    // IDLE_FADE_FRACTION (0.3) of the traverse phase's own end -- reaches 0 partway through
    // `traverse`, not just by `change`.
    const fadeEndT = traversePhase.end * 0.3;
    expect(frameAt(fadeEndT).idleWeight).toBeCloseTo(0, 6);
    expect(frameAt(traversePhase.end).idleWeight).toBe(0);
  });
});

describe('mountScale / seatAdjust (phase + local driven)', () => {
  it('mountScale is 1 for every phase before `related`', () => {
    expect(frameAt(0).mountScale).toBe(1);
    expect(frameAt(traversePhase.end - 0.001).mountScale).toBe(1);
  });

  it('mountScale ramps 1 -> MOUNT_SCALE across local 0.1..0.7 of `related`', () => {
    expect(frameAt(tAtLocal(relatedPhase, 0.1)).mountScale).toBeCloseTo(1, 10);
    expect(frameAt(tAtLocal(relatedPhase, 0.4)).mountScale).toBeCloseTo(1 + (MOUNT_SCALE - 1) * 0.5, 10);
    expect(frameAt(tAtLocal(relatedPhase, 0.7)).mountScale).toBeCloseTo(MOUNT_SCALE, 10);
  });

  it('mountScale holds at MOUNT_SCALE for the rest of `related` and all of `success`', () => {
    expect(frameAt(relatedPhase.end - 0.001).mountScale).toBeCloseTo(MOUNT_SCALE, 10);
    expect(frameAt(tAtLocal(successPhase, 0.5)).mountScale).toBe(MOUNT_SCALE);
    expect(frameAt(100).mountScale).toBe(MOUNT_SCALE);
  });

  it('seatAdjust is 0 everywhere outside `success`', () => {
    expect(frameAt(0).seatAdjust).toBe(0);
    expect(frameAt(relatedPhase.end - 0.001).seatAdjust).toBe(0);
  });

  it('seatAdjust eases 0 -> 1 across local 0..0.7 of `success`, then holds at 1', () => {
    expect(frameAt(successPhase.start).seatAdjust).toBe(0);
    const local = 0.35;
    const expected = ease(ramp(local, 0, 0.7));
    expect(frameAt(tAtLocal(successPhase, local)).seatAdjust).toBeCloseTo(expected, 10);
    expect(frameAt(tAtLocal(successPhase, 0.7)).seatAdjust).toBeCloseTo(1, 10);
    expect(frameAt(100).seatAdjust).toBeCloseTo(1, 10);
  });
});

describe('invariant sweep over the whole timeline (t=0..100, step 0.5)', () => {
  const samples: number[] = [];
  for (let t = 0; t <= 100; t += 0.5) samples.push(t);

  const zeroToOneFields = [
    'explode',
    'frontDriveExplode',
    'seatAdjust',
    'blue',
    'ringRed',
    'red',
    'pistonRed',
    'finalGreen',
    'boxWeight',
    'preHighlightOrange',
    'idleWeight'
  ] as const;

  it.each(zeroToOneFields)('%s stays within [0,1] (epsilon-tolerant) for every sampled t', (field) => {
    for (const t of samples) {
      const value = frameAt(t)[field];
      expect(value, `${field} at t=${t}`).toBeGreaterThanOrEqual(-1e-9);
      expect(value, `${field} at t=${t}`).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('frontDriveScale stays within [1, FRONT_SCALE]', () => {
    for (const t of samples) {
      const value = frameAt(t).frontDriveScale;
      expect(value, `frontDriveScale at t=${t}`).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(value, `frontDriveScale at t=${t}`).toBeLessThanOrEqual(FRONT_SCALE + 1e-9);
    }
  });

  it('mountScale stays within [1, MOUNT_SCALE]', () => {
    for (const t of samples) {
      const value = frameAt(t).mountScale;
      expect(value, `mountScale at t=${t}`).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(value, `mountScale at t=${t}`).toBeLessThanOrEqual(MOUNT_SCALE + 1e-9);
    }
  });

  it('none of the 0..1 fields ever go meaningfully negative (documents whether the epsilon tolerance above is actually exercised)', () => {
    let sawNegative = false;
    for (const t of samples) {
      const frame = frameAt(t);
      for (const field of zeroToOneFields) {
        if (frame[field] < 0) sawNegative = true;
      }
    }
    expect(sawNegative).toBe(false);
  });
});
