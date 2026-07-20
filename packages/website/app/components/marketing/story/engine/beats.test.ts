import { describe, expect, it } from 'vitest';
import { clamp01, deriveScene, lerp, TIMELINE } from '../scene';
import {
  AZIMUTH_DRIFT,
  CANONICAL_AZIMUTH,
  CANONICAL_ELEVATION,
  engineFrame,
  FRONT_SCALE,
  MARGIN_ASSEMBLED,
  MARGIN_EXPLODED,
  MOUNT_SCALE,
  RETURN_TO_NORMAL_END_T,
  RETURN_TO_NORMAL_START_T
} from './beats';

// Authoritative timeline breakpoints, taken from beats.ts's own header comment (t 7.5-8 ... t
// 83-87). These are deliberately re-declared here (not imported) since beats.ts doesn't export
// its internal `*_START_T`/`*_END_T` constants -- they're the contract under test.
const CAMERA_SETTLE_T = 12.3;
const ORANGE_IN_START_T = 7.5;
const ORANGE_IN_END_T = 8;
const ORANGE_OUT_START_T = 16;
const ORANGE_OUT_END_T = 20;
const RING_BLUE_START_T = 16;
const RING_BLUE_END_T = 20;
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
const FAILED_FIT_COLLAPSE_START_T = 32;
const FAILED_FIT_COLLAPSE_END_T = 43;
const FAILED_FIT_REEXPLODE_START_T = 48;
const FAILED_FIT_REEXPLODE_END_T = 58;
const BOX_IN_START_T = 58;
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

  it('is 1 from t=20 through t=30', () => {
    expect(frameAt(RING_BLUE_END_T).blue).toBe(1);
    expect(frameAt(26).blue).toBe(1);
    expect(frameAt(MISMATCH_RED_START_T).blue).toBe(1);
  });

  it('is 0 at t>=34', () => {
    expect(frameAt(MISMATCH_RED_END_T).blue).toBe(0);
    expect(frameAt(40).blue).toBe(0);
    expect(frameAt(100).blue).toBe(0);
  });
});

describe('ringRed (ring gear second stage)', () => {
  it('is 0 before the mismatch-red window starts', () => {
    expect(frameAt(MISMATCH_RED_START_T).ringRed).toBe(0);
  });

  it('is 1 at t=34..46', () => {
    expect(frameAt(MISMATCH_RED_END_T).ringRed).toBe(1);
    expect(frameAt(40).ringRed).toBe(1);
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

  it('is 1 across the held plateau, t=72..93', () => {
    expect(frameAt(RESOLVE_GREEN_END_T).finalGreen).toBe(1);
    expect(frameAt(80).finalGreen).toBe(1);
    expect(frameAt(RETURN_TO_NORMAL_START_T).finalGreen).toBe(1);
  });

  it('ramps linearly mid-window', () => {
    const mid = (RESOLVE_GREEN_START_T + RESOLVE_GREEN_END_T) / 2;
    expect(frameAt(mid).finalGreen).toBeCloseTo(0.5, 10);
  });

  it('releases back to 0 over RETURN_TO_NORMAL_START_T..END_T, and is 0 at t=100', () => {
    const mid = (RETURN_TO_NORMAL_START_T + RETURN_TO_NORMAL_END_T) / 2;
    expect(frameAt(mid).finalGreen).toBeCloseTo(0.5, 10);
    expect(frameAt(RETURN_TO_NORMAL_END_T).finalGreen).toBe(0);
    expect(frameAt(100).finalGreen).toBe(0);
  });
});

describe('boxWeight', () => {
  it('is 0 until the failed-fit re-explode has finished (t<=58)', () => {
    expect(frameAt(0).boxWeight).toBe(0);
    expect(frameAt(COLOR_LOSS_START_T).boxWeight).toBe(0);
    expect(frameAt(55).boxWeight).toBe(0);
    expect(frameAt(BOX_IN_START_T).boxWeight).toBe(0);
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
  it('cycles 1 -> 1.25 (t27-46) -> 1 (t60-72) -> 1.25 (t83..93)', () => {
    expect(frameAt(0).frontDriveScale).toBe(1);
    expect(frameAt(RING_RESIZE_START_T).frontDriveScale).toBe(1);
    expect(frameAt(RING_RESIZE_END_T).frontDriveScale).toBe(FRONT_SCALE);
    expect(frameAt(COLOR_LOSS_START_T).frontDriveScale).toBe(FRONT_SCALE);
    expect(frameAt(RESOLVE_GREEN_START_T).frontDriveScale).toBe(1);
    expect(frameAt(RING_REGROW_START_T).frontDriveScale).toBe(1);
    expect(frameAt(RING_REGROW_END_T).frontDriveScale).toBe(FRONT_SCALE);
    expect(frameAt(93).frontDriveScale).toBe(FRONT_SCALE);
  });

  it('shrinks back to 1x during the color-loss window', () => {
    expect(frameAt(COLOR_LOSS_END_T).frontDriveScale).toBe(1);
  });

  it('holds 1x through the whole blue window -- the resize is its own later beat (t22-27)', () => {
    expect(frameAt(RING_BLUE_END_T).frontDriveScale).toBe(1);
  });

  it('eases back to 1x over RETURN_TO_NORMAL_START_T..END_T, and is exactly 1 at t=100', () => {
    const mid = (RETURN_TO_NORMAL_START_T + RETURN_TO_NORMAL_END_T) / 2;
    expect(frameAt(mid).frontDriveScale).toBeCloseTo(lerp(1, FRONT_SCALE, 0.5), 10);
    expect(frameAt(RETURN_TO_NORMAL_END_T).frontDriveScale).toBe(1);
    expect(frameAt(100).frontDriveScale).toBe(1);
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

  it('is 1 from CAMERA_SETTLE_T until the failed-fit collapse begins', () => {
    expect(frameAt(CAMERA_SETTLE_T).explode).toBe(1);
    expect(frameAt(20).explode).toBe(1);
    expect(frameAt(FAILED_FIT_COLLAPSE_START_T).explode).toBe(1);
  });

  it('failed fit: fully collapsed from t=43 through t=48, mid-way at the window midpoints', () => {
    const collapseMid = (FAILED_FIT_COLLAPSE_START_T + FAILED_FIT_COLLAPSE_END_T) / 2;
    const reexplodeMid = (FAILED_FIT_REEXPLODE_START_T + FAILED_FIT_REEXPLODE_END_T) / 2;
    expect(frameAt(collapseMid).explode).toBeCloseTo(0.5, 10);
    expect(frameAt(FAILED_FIT_COLLAPSE_END_T).explode).toBe(0);
    expect(frameAt(45).explode).toBe(0);
    expect(frameAt(FAILED_FIT_REEXPLODE_START_T).explode).toBe(0);
    expect(frameAt(reexplodeMid).explode).toBeCloseTo(0.5, 10);
  });

  it('re-exploded to 1 from t=58 through the start of the final reassembly', () => {
    expect(frameAt(FAILED_FIT_REEXPLODE_END_T).explode).toBe(1);
    expect(frameAt(70).explode).toBe(1);
    expect(frameAt(FINAL_REASSEMBLY_START_T).explode).toBe(1);
  });

  it('collapses to 0 by t=87 and stays there', () => {
    expect(frameAt(FINAL_REASSEMBLY_END_T).explode).toBe(0);
    expect(frameAt(100).explode).toBe(0);
  });
});

describe('camera settle: margin, azimuth, elevation', () => {
  it('margin rides the explode curve: MARGIN_EXPLODED whenever fully exploded', () => {
    expect(frameAt(CAMERA_SETTLE_T).margin).toBeCloseTo(MARGIN_EXPLODED, 10);
    expect(frameAt(FAILED_FIT_COLLAPSE_START_T).margin).toBe(MARGIN_EXPLODED);
    expect(frameAt(70).margin).toBe(MARGIN_EXPLODED);
    expect(frameAt(FINAL_REASSEMBLY_START_T).margin).toBe(MARGIN_EXPLODED);
  });

  it('margin is MARGIN_ASSEMBLED for every collapsed pose -- hero, the failed-fit hold, and t87..100 all share the hero framing', () => {
    expect(frameAt(0).margin).toBe(MARGIN_ASSEMBLED);
    expect(frameAt(FAILED_FIT_COLLAPSE_END_T).margin).toBe(MARGIN_ASSEMBLED);
    expect(frameAt(45).margin).toBe(MARGIN_ASSEMBLED);
    expect(frameAt(FAILED_FIT_REEXPLODE_START_T).margin).toBe(MARGIN_ASSEMBLED);
    expect(frameAt(FINAL_REASSEMBLY_END_T).margin).toBe(MARGIN_ASSEMBLED);
    expect(frameAt(88).margin).toBe(MARGIN_ASSEMBLED);
    expect(frameAt(RETURN_TO_NORMAL_START_T).margin).toBe(MARGIN_ASSEMBLED);
    expect(frameAt(100).margin).toBe(MARGIN_ASSEMBLED);
  });

  it('margin blends on the same ramps that move the parts', () => {
    const mid = (FINAL_REASSEMBLY_START_T + FINAL_REASSEMBLY_END_T) / 2;
    expect(frameAt(mid).margin).toBeCloseTo(lerp(MARGIN_ASSEMBLED, MARGIN_EXPLODED, frameAt(mid).explode), 10);
    const collapseMid = (FAILED_FIT_COLLAPSE_START_T + FAILED_FIT_COLLAPSE_END_T) / 2;
    expect(frameAt(collapseMid).margin).toBeCloseTo(
      lerp(MARGIN_ASSEMBLED, MARGIN_EXPLODED, frameAt(collapseMid).explode),
      10
    );
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

  it('is 0 from the top of `change` through the whole mismatch story, up to RETURN_TO_NORMAL_START_T', () => {
    const changePhase = TIMELINE.find((phase) => phase.id === 'change')!;
    expect(frameAt(changePhase.start).idleWeight).toBe(0);
    expect(frameAt(45).idleWeight).toBe(0);
    expect(frameAt(RETURN_TO_NORMAL_START_T).idleWeight).toBe(0);
  });

  it('fades out within the leading fraction of hero+traverse, well before traverse ends', () => {
    // IDLE_FADE_FRACTION (0.3) of the traverse phase's own end -- reaches 0 partway through
    // `traverse`, not just by `change`.
    const fadeEndT = traversePhase.end * 0.3;
    expect(frameAt(fadeEndT).idleWeight).toBeCloseTo(0, 6);
    expect(frameAt(traversePhase.end).idleWeight).toBe(0);
  });

  it('fades back in over RETURN_TO_NORMAL_START_T..END_T, reaching 1 at t=100', () => {
    const mid = (RETURN_TO_NORMAL_START_T + RETURN_TO_NORMAL_END_T) / 2;
    expect(frameAt(mid).idleWeight).toBeCloseTo(0.5, 10);
    expect(frameAt(RETURN_TO_NORMAL_END_T).idleWeight).toBe(1);
    expect(frameAt(100).idleWeight).toBe(1);
  });
});

describe('mountScale (pure function of t)', () => {
  it('mountScale is 1 for every phase before `related`', () => {
    expect(frameAt(0).mountScale).toBe(1);
    expect(frameAt(traversePhase.end - 0.001).mountScale).toBe(1);
  });

  it('mountScale ramps 1 -> MOUNT_SCALE across local 0.1..0.7 of `related`', () => {
    expect(frameAt(tAtLocal(relatedPhase, 0.1)).mountScale).toBeCloseTo(1, 10);
    expect(frameAt(tAtLocal(relatedPhase, 0.4)).mountScale).toBeCloseTo(1 + (MOUNT_SCALE - 1) * 0.5, 10);
    expect(frameAt(tAtLocal(relatedPhase, 0.7)).mountScale).toBeCloseTo(MOUNT_SCALE, 10);
  });

  it('mountScale holds at MOUNT_SCALE from the end of its growth window up to RETURN_TO_NORMAL_START_T', () => {
    // `related` ends at ~96.97, well after RETURN_TO_NORMAL_START_T (93) -- the whole of `success`
    // (96.97..100) falls inside the return-to-normal window, so the plateau is only observable
    // from the growth window's end (~91.5, still inside `related`) through t=93.
    expect(frameAt(tAtLocal(relatedPhase, 0.7)).mountScale).toBeCloseTo(MOUNT_SCALE, 10);
    expect(frameAt(RETURN_TO_NORMAL_START_T).mountScale).toBeCloseTo(MOUNT_SCALE, 10);
  });

  it('eases back to exactly 1 by t=100', () => {
    const mid = (RETURN_TO_NORMAL_START_T + RETURN_TO_NORMAL_END_T) / 2;
    expect(frameAt(mid).mountScale).toBeCloseTo(lerp(1, MOUNT_SCALE, 0.5), 10);
    expect(frameAt(RETURN_TO_NORMAL_END_T).mountScale).toBe(1);
    expect(frameAt(100).mountScale).toBe(1);
  });
});

describe('invariant sweep over the whole timeline (t=0..100, step 0.5)', () => {
  const samples: number[] = [];
  for (let t = 0; t <= 100; t += 0.5) samples.push(t);

  const zeroToOneFields = [
    'explode',
    'frontDriveExplode',
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

describe('regression: ring gear no longer drops at t≈96 (issue #1 -- seatAdjust removed)', () => {
  it('EngineFrame carries no seat-related field', () => {
    const frame = frameAt(tAtLocal(successPhase, 0.35));
    expect(frame).not.toHaveProperty('seatAdjust');
  });

  it('no positional beat exists anywhere past t=87 -- explode (the only field that ever moves a part) stays exactly 0 for the rest of the timeline, including across all of `success`', () => {
    for (let t = FINAL_REASSEMBLY_END_T; t <= 100; t += 0.5) {
      expect(frameAt(t).explode, `explode at t=${t}`).toBe(0);
      expect(frameAt(t).frontDriveExplode, `frontDriveExplode at t=${t}`).toBe(0);
    }
    // Specifically inside `success`, where the drop was reported (t≈96).
    expect(frameAt(tAtLocal(successPhase, 0.35)).explode).toBe(0);
  });
});

describe('regression: every mismatch component returns to normal by t=100, engine idle-rotating like the hero (issue #2)', () => {
  it('at t=100: finalGreen, frontDriveScale, mountScale, idleWeight, and margin all match their hero-opening values', () => {
    const frame = frameAt(100);
    expect(frame.finalGreen).toBe(0);
    expect(frame.frontDriveScale).toBe(1);
    expect(frame.mountScale).toBe(1);
    expect(frame.idleWeight).toBe(1);
    expect(frame.margin).toBe(MARGIN_ASSEMBLED);
  });
});
