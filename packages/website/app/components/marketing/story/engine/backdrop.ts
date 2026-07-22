// Pure t -> stage backdrop color choreography, mirroring beats.ts's "no phase switch, only t"
// discipline: every export here is a function of `t` alone, safe to call from both the plain CSS
// panel (EngineStage.tsx, which never touches WebGL) and the fog color threaded through
// EngineFrame (see beats.ts's engineFrame -> EngineScene.ts's applyFrame). The two must always
// agree, since fog is what makes the WebGL canvas's transparent edges disappear into the CSS
// panel behind it -- the whole point of this module existing separately from beats.ts is to give
// both consumers one shared source instead of two color computations that could drift apart.
import { clamp01, lerp, ramp } from '../scene';
import { STAGE_BACKGROUND_DEFAULT_CSS } from './stage';

interface Beat {
  t: number;
  color: string;
}

// Flat hold across t ± HOLD_HALF_WIDTH; ramps across the HOLD_HALF_WIDTH..HOLD_HALF_WIDTH +
// FADE_WIDTH skirt on either side (t ± 2 through t ± 5). The remaining two beats (45 and 88) sit
// 43 apart, comfortably outside two 5-unit skirts, so beats never overlap and a beat's weight can
// be applied as a single default -> color lerp with no cross-beat blending to reason about. The
// original t12 pale-blue beat was cut, and the t27.4 dark-graphite beat (the "Missing context"
// step's backdrop) was cut too -- both windows now stay at the default color.
const HOLD_HALF_WIDTH = 2;
const FADE_WIDTH = 3;

// Red and green share the same S/L (S45%/L35%) and are each hued to match --color-negative /
// --color-positive exactly (4.5° / 135.95°, see global.css) so they read as a matched pair and
// stay aligned with every other red/green color on the page -- keep any future retune of one
// mirrored in the other, on those same two hues.
const BEATS: readonly Beat[] = [
  { t: 45, color: '#813731' }, // muted but bright brick red
  { t: 88, color: '#318146' } // muted but bright sage green -- same S/L as the t45 red
];

type Rgb = readonly [number, number, number];

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgbToHex([r, g, b]: Rgb): string {
  const channel = (v: number) =>
    Math.round(clamp01(v / 255) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// 0..1: 0 outside the beat's window entirely, 1 across its flat hold, ramping linearly through
// the two skirts in between.
function beatWeightAt(beatT: number, t: number): number {
  const fadeIn = ramp(t, beatT - HOLD_HALF_WIDTH - FADE_WIDTH, beatT - HOLD_HALF_WIDTH);
  const fadeOut = 1 - ramp(t, beatT + HOLD_HALF_WIDTH, beatT + HOLD_HALF_WIDTH + FADE_WIDTH);
  return Math.min(fadeIn, fadeOut);
}

const DEFAULT_RGB = hexToRgb(STAGE_BACKGROUND_DEFAULT_CSS);
const BEAT_RGB = BEATS.map((beat) => hexToRgb(beat.color));

// The flat panel/fog color at `t` -- default outside every beat's window, the beat's own color
// across its hold, blended through the fade skirts. Since beats never overlap (see BEATS'
// comment), at most one weight is ever non-zero, so a plain sequential lerp from the default is
// exact, not an approximation.
export function stageEdgeColorAt(t: number): string {
  let rgb: Rgb = DEFAULT_RGB;
  BEATS.forEach((beat, index) => {
    const weight = beatWeightAt(beat.t, t);
    if (weight > 0) rgb = mixRgb(rgb, BEAT_RGB[index], weight);
  });
  return rgbToHex(rgb);
}

export function stageEdgeColorHexAt(t: number): number {
  return parseInt(stageEdgeColorAt(t).slice(1), 16);
}

// 0 (default, no beat active) .. 1 (fully inside a beat's flat hold): how strongly a beat color
// is currently showing. Beats never overlap (see BEATS' comment above), so at most one term is
// ever non-zero and summing is exact, not an approximation of a max.
function beatIntensityAt(t: number): number {
  return BEATS.reduce((total, beat) => total + beatWeightAt(beat.t, t), 0);
}

// text-ink-tertiary-deep from global.css (#797d84) -- duplicated here rather than read from the
// CSS custom property since this module is plain t -> color math with no DOM access. Keep in
// sync if that token is retuned.
const LABEL_DEFAULT_RGB: Rgb = hexToRgb('#797d84');
const LABEL_LIT_RGB: Rgb = [255, 255, 255];

// The engine figure label (EngineStage.tsx) fades from its resting tertiary-ink color to white
// in lockstep with the backdrop: the gray/red/green beats all read as dark-to-saturated panels
// where the default dark-grey label would lose contrast, so it fades to white across the exact
// same skirts as the panel color itself instead of jumping or lagging behind it.
export function stageLabelColorAt(t: number): string {
  return rgbToHex(mixRgb(LABEL_DEFAULT_RGB, LABEL_LIT_RGB, clamp01(beatIntensityAt(t))));
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case rn:
      h = (gn - bn) / d + (gn < bn ? 6 : 0);
      break;
    case gn:
      h = (bn - rn) / d + 2;
      break;
    default:
      h = (rn - gn) / d + 4;
  }
  return [h * 60, s, l];
}

function hueToRgbChannel(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hn = h / 360;
  const r = hueToRgbChannel(p, q, hn + 1 / 3);
  const g = hueToRgbChannel(p, q, hn);
  const b = hueToRgbChannel(p, q, hn - 1 / 3);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// The radial glow's core: the same edge color, lightened and lifted in saturation by a fixed
// *proportion of remaining headroom* toward white/full saturation -- not a fixed number of
// points. An additive lift clips to flat white on the already-pale states (default and t12 sit
// at 93-96% L, so a flat +7pt lift oversteps 100% and washes out their hue entirely); scaling by
// headroom keeps every state's core a lightened/richer version of its own edge color instead of
// converging on the same white. One formula shared by every state (including the resting
// default), so the glow still reads as one consistent material property of the stage, just one
// whose visible pop naturally scales with how much room a color has to lighten. Tuned down from
// an initial flat-delta pass the user flagged as reading like a literal spotlight; see the
// swatch/mockup artifact from the design discussion for the visual comparison this was picked
// against.
const CORE_LIGHTNESS_LIFT_FRACTION = 0.09; // of the distance from edge L to 100%
const CORE_SATURATION_LIFT_FRACTION = 0.12; // of the distance from edge S to 100%

function coreColorFor(edgeHex: string): string {
  const [h, s, l] = rgbToHsl(hexToRgb(edgeHex));
  const coreS = clamp01(s + (1 - s) * CORE_SATURATION_LIFT_FRACTION);
  const coreL = clamp01(l + (1 - l) * CORE_LIGHTNESS_LIFT_FRACTION);
  return rgbToHex(hslToRgb(h, coreS, coreL));
}

// Full CSS background for the stage panel: a radial gradient from the lightened core (tight, 8%
// radius) blending back out to the flat edge color by 55% -- past that the panel is flat, so the
// glow reads as ambient light near the engine rather than a lit backdrop. The edge stop is always
// exactly `stageEdgeColorAt(t)`, the same color threaded into the WebGL fog, so the canvas's
// transparent edges still disappear into the panel with no seam.
export function stageBackgroundCssAt(t: number): string {
  const edge = stageEdgeColorAt(t);
  const core = coreColorFor(edge);
  return `radial-gradient(circle at 50% 46%, ${core} 0%, ${core} 8%, ${edge} 55%, ${edge} 100%)`;
}
