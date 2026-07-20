// The highlight color system: per-part emissive/diffuse recoloring driven by the EngineFrame's
// highlight weights, plus the independent wall-clock heartbeat pulse layered on top of them. Pure
// besides the `three` types it operates on -- holds no mutable module state; all per-scene state
// (the HighlightRecord list, the pulse cycle/weight) lives in EngineScene.
import * as THREE from 'three';
import { lerp } from '../scene';
import { type EngineFrame, HIGHLIGHT_BLUE, HIGHLIGHT_GREEN, HIGHLIGHT_ORANGE, HIGHLIGHT_RED } from './beats';
import type { PartRecord } from './types';

// Selective bloom: only objects on this layer ever contribute to the bloom pass. A highlightable
// part enables this layer on itself (see updateHighlights) only while its own combined emissive
// contribution is actually nonzero -- so ordinary specular highlights on lit metal parts (from the
// key light/HDR environment) never cross the bloom threshold, only genuine "just got hot" glow
// does. Used as a lookup marker for the darken-non-bloomed technique in EngineScene's render(),
// not for camera-layer exclusion -- see that method's comment for why.
export const BLOOM_LAYER = 1;

// 'orange' is the shared pre-highlight pulse (frame.preHighlightOrange) on the gear, pistons, and
// engineBackCover. 'blue' and 'ringRed' are the gear's own two-stage transition (frame.blue, then
// frame.ringRed). 'red' is engineBackCover's mismatch beat (frame.red); 'pistonRed' is the
// pistons' (frame.pistonRed) -- both ramp in lockstep with the gear's 'ringRed'. 'finalGreen' is
// the shared resolved color every one of these parts (plus the mount) settles into
// (frame.finalGreen).
export type HighlightKind = 'blue' | 'ringRed' | 'red' | 'pistonRed' | 'orange' | 'finalGreen';

export interface HighlightStage {
  kind: HighlightKind;
  // This kind's cold-state color identity (see beats.ts's HIGHLIGHT_* hexes) -- blackbodyColor
  // (see below) modulates FROM this hue toward a hotter/whiter emissive color as this frame's
  // weight and the heartbeat pulse rise; it's never mutated after buildHighlightRecords.
  baseColor: THREE.Color;
}

// A highlightable part can carry more than one possible stage (e.g. the gear cycles through
// orange -> blue -> ringRed -> finalGreen over the timeline) and, during a crossfade where one
// stage's intensity ramps down exactly as the next ramps up (see beats.ts -- ringBlue and
// mismatchRed(ringRed) sum to 1 across t28-41), more than one stage can be simultaneously active.
// updateHighlights sums every active stage's emissive contribution directly onto this part's own
// material rather than layering separate meshes, so a two-stage crossfade blends as true additive
// light mixing on one surface instead of two coincident overlays.
export interface HighlightRecord {
  mesh: THREE.Mesh;
  stages: HighlightStage[];
  // The part's own unhighlighted albedo (captured once, from its cloned material -- see the
  // material-cloning comment in EngineScene.ts's load()). Emissive alone, added on top of this
  // part's real (often near-neutral gray metal) diffuse+specular shading, reads as a pale tint
  // rather than a vivid color -- the achromatic base dominates the sum. updateHighlights also
  // drives `color` itself, mixing from this identity toward the active stage's hue, so the surface
  // actually reads as that color rather than merely having light of that color added on top of it.
  baseMaterialColor: THREE.Color;
}

// --- Highlight heartbeat ------------------------------------------------------------------
// Every highlight (buildHighlightRecords/updateHighlights) -- every kind alike, including
// 'orange' -- pulses at a steady real-time rate, ~45 BPM (one full cycle a bit faster than every
// two seconds). This is layered on top of whatever intensity the EngineFrame already computed
// (frame.blue/ringRed/red/pistonRed/finalGreen/preHighlightOrange); it never changes *whether* a
// part is glowing, only how hot it glows while it is. The bounding box (updateBoundingBox in
// mismatchBox.ts) is deliberately never touched by this pulse -- it's a plain static/steady prop,
// not part of the pulsing highlight set.
export const HEARTBEAT_HZ = 0.75; // ~45 BPM

// One continuous sine per cycle rather than a snappy attack/decay -- a single smooth breathe with
// no flat "rest" segment or hard corner anywhere in the cycle. pulseCycle is a 0..1 fraction of
// one HEARTBEAT_HZ period; the waveform is 2*pi-periodic in it, so scrubbing/wrapping never pops.
export function pulseWave(cycle: number): number {
  return (1 - Math.cos(2 * Math.PI * cycle)) / 2;
}

// Emissive intensity ("how hot the part's glow reads") is `frame`-weight times a per-kind base
// tier (red-family beats read hotter than blue/green) times a pulse-driven multiplier that only
// exceeds the bloom pass's threshold (see the composer built in EngineScene's constructor) at the
// peak of the heartbeat on an already fully-active highlight -- never at rest, never on a
// half-transitioned one. This is what makes UnrealBloomPass's halo read as "this part just got
// hot", a real-time accent, rather than a permanent glow baked into every highlight.
//
// Emissive is driven directly on each highlightable part's own material (see updateHighlights)
// rather than through a separate additive-blended overlay mesh whose own diffuse was pinned to
// black. That isolation is gone: this material's real diffuse+specular (under the key light/HDR
// environment) is already nonzero before emissive adds on top, so EMISSIVE_SCALE has to stay low
// enough that the sum doesn't cross into ACESFilmicToneMapping's highlight rolloff -- past that
// point the tonemapper desaturates bright pixels toward white regardless of the source hue, which
// is what "not saturated enough" actually was (not a hue problem -- an overexposure one).
const EMISSIVE_TIER_HIGH = 0.55; // red / ringRed / pistonRed
const EMISSIVE_TIER_MID = 0.45; // blue / finalGreen
const EMISSIVE_TIER_LOW = 0.5; // orange (shared pre-highlight)
const EMISSIVE_SCALE = 0.32;
const HEARTBEAT_HEAT_PEAK_MULTIPLIER = 1.15; // emissiveIntensity multiplier at pulseWeight===1
// `heat` (see updateHighlights) is capped well short of 1 so a fully-active highlight at pulse
// peak reads as hot-orange/red, never the near-white top of blackbodyColor's ramp -- every
// highlight kind pulsing to white at ~45 BPM read as the whole engine flashing white/overexposed
// rather than a warm, localized "just got hot" accent.
const HEARTBEAT_HEAT_PEAK_CAP = 0.62;

// Blackbody-ish color ramp: as `heat` (frame weight combined with the heartbeat pulse, see
// updateHighlights) rises, the emissive color moves from a dim ember of its own base hue, through
// a slightly warmer/brighter version of that hue, to a saturated hot peak -- real thermal glow
// shifts hue and (up to a point) lightens with temperature rather than just getting brighter at a
// fixed hue. `heat` is clamped to 0..1 by the caller; the two segments below split that range at
// its midpoint so every kind still visibly holds its own color identity through the first half
// before the temperature shift takes over.
const BLACKBODY_WARM_HUE = 30 / 360; // orange -- the shared "hotter" hue every kind trends toward
const BLACKBODY_EMBER_LIGHTNESS = 0.14;
// Peak values are what `heat` reaches at HEARTBEAT_HEAT_PEAK_CAP, not a literal 1.0 -- tuned to
// read as hot-orange/red-hot, not the paper-white a true blackbody curve would hit at its extreme.
// Saturation is kept high all the way to peak (unlike a literal blackbody curve, which would
// desaturate toward white) so the glow reads as a vivid hot color rather than washing out.
const BLACKBODY_PEAK_LIGHTNESS = 0.52;
const BLACKBODY_PEAK_SATURATION = 0.92;

export function blackbodyColor(base: THREE.Color, heat: number): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  const clamped = THREE.MathUtils.clamp(heat, 0, 1);

  // First half (0..0.5): rise out of a dim ember of the base hue up to that hue's own natural
  // lightness, with only a mild hue nudge toward warm -- this is where each kind's identity reads
  // most clearly.
  const emberT = Math.min(clamped / 0.5, 1);
  const hue = lerp(hsl.h, BLACKBODY_WARM_HUE, emberT * 0.4);
  const emberLightness = lerp(BLACKBODY_EMBER_LIGHTNESS, Math.max(hsl.l, 0.45), emberT);

  // Second half (0.5..1): lighten and saturate further toward a vivid hot peak as heat approaches
  // its cap -- the point where bloom picks the highlight up.
  const whiteT = Math.max((clamped - 0.5) / 0.5, 0);
  const lightness = lerp(emberLightness, BLACKBODY_PEAK_LIGHTNESS, whiteT);
  const saturation = lerp(Math.max(hsl.s, 0.6), BLACKBODY_PEAK_SATURATION, whiteT);

  return new THREE.Color().setHSL(hue, saturation, lightness);
}

function intensityForKind(kind: HighlightKind, frame: EngineFrame): number {
  switch (kind) {
    case 'blue':
      return frame.blue;
    case 'ringRed':
      return frame.ringRed;
    case 'red':
      return frame.red;
    case 'pistonRed':
      return frame.pistonRed;
    case 'finalGreen':
      return frame.finalGreen;
    case 'orange':
      return frame.preHighlightOrange; // one shared weight across the gear + pistons + cover
  }
}

function tierForKind(kind: HighlightKind): number {
  switch (kind) {
    case 'red':
    case 'ringRed':
    case 'pistonRed':
      return EMISSIVE_TIER_HIGH;
    case 'blue':
    case 'finalGreen':
      return EMISSIVE_TIER_MID;
    case 'orange':
      return EMISSIVE_TIER_LOW;
  }
}

// Highlight color/intensity is driven directly on each highlightable part's own (per-part-cloned
// -- see the material-cloning comment in EngineScene.ts's load()) material, not through a separate
// overlay mesh. An earlier version added slightly-oversized additive-blended "shell" meshes as
// children of each part instead; those read as a visible separate glowing container around the
// part rather than the part's own surface glowing, and needed their own independent fog handling
// that never quite matched the real part underneath. Driving emissive on the real material
// sidesteps both: there's only one surface, and it's fogged exactly once, the same way as every
// other part.
export function buildHighlightRecords(
  frontDriveParts: PartRecord[],
  mountPart: PartRecord | null,
  orangeEmphasisParts: PartRecord[]
): HighlightRecord[] {
  const stage = (kind: HighlightKind, colorHex: string): HighlightStage => ({
    kind,
    baseColor: new THREE.Color(colorHex)
  });

  const baseColorOf = (mesh: THREE.Mesh): THREE.Color => (mesh.material as THREE.MeshStandardMaterial).color.clone();

  const records: HighlightRecord[] = [];
  for (const part of frontDriveParts) {
    records.push({
      mesh: part.mesh,
      baseMaterialColor: baseColorOf(part.mesh),
      stages: [
        stage('orange', HIGHLIGHT_ORANGE),
        stage('blue', HIGHLIGHT_BLUE),
        stage('ringRed', HIGHLIGHT_RED),
        stage('finalGreen', HIGHLIGHT_GREEN)
      ]
    });
  }
  if (mountPart) {
    // engineBackCover shares the pistons' pre-highlight orange (frame.preHighlightOrange), flips
    // to red in lockstep with the gear's ringRed and the pistons' pistonRed (frame.red), then
    // settles to the same shared green as the rest of the mismatch story (frame.finalGreen).
    records.push({
      mesh: mountPart.mesh,
      baseMaterialColor: baseColorOf(mountPart.mesh),
      stages: [stage('orange', HIGHLIGHT_ORANGE), stage('red', HIGHLIGHT_RED), stage('finalGreen', HIGHLIGHT_GREEN)]
    });
  }
  // ORANGE_EMPHASIS parts (piston001-008): the same pre-highlight glow as the gear (frame.
  // preHighlightOrange), then their own red beat (frame.pistonRed) in lockstep with the gear's
  // ringRed, then the same shared final green (frame.finalGreen).
  for (const part of orangeEmphasisParts) {
    records.push({
      mesh: part.mesh,
      baseMaterialColor: baseColorOf(part.mesh),
      stages: [
        stage('orange', HIGHLIGHT_ORANGE),
        stage('pistonRed', HIGHLIGHT_RED),
        stage('finalGreen', HIGHLIGHT_GREEN)
      ]
    });
  }
  return records;
}

// Sums every one of a part's active stages (see HighlightRecord's doc comment on why more than
// one can be simultaneously active) into a single emissive contribution on that part's own
// material -- true additive light mixing on one surface, rather than layering separate meshes.
// Only enables BLOOM_LAYER on the part while that sum is actually nonzero, so a highlightable
// part's ordinary lit shading (specular off the key light/HDR environment) never itself
// contributes to the bloom pass -- only genuine "just got hot" glow does.
export function updateHighlights(records: HighlightRecord[], frame: EngineFrame, pulseWeight: number): void {
  const stageColor = new THREE.Color();
  const identityColor = new THREE.Color();
  for (const record of records) {
    const total = new THREE.Color(0, 0, 0);
    identityColor.setRGB(0, 0, 0);
    let magnitude = 0;
    let colorWeight = 0;

    for (const highlightStage of record.stages) {
      const intensity = intensityForKind(highlightStage.kind, frame);
      if (intensity < 0.001) continue;
      const tier = tierForKind(highlightStage.kind);

      // `heat` drives the blackbody color ramp: at pulseWeight 0 it never exceeds `tier` itself
      // (~0.45-0.55, well short of hot); only a fully-active stage (intensity===1) at the
      // pulse's peak reaches HEARTBEAT_HEAT_PEAK_CAP, never a full 1 -- see that constant's doc
      // comment for why the cap exists.
      const heat = intensity * lerp(tier, HEARTBEAT_HEAT_PEAK_CAP, pulseWeight);
      const stageIntensity = intensity * tier * EMISSIVE_SCALE * lerp(1, HEARTBEAT_HEAT_PEAK_MULTIPLIER, pulseWeight);

      stageColor.copy(blackbodyColor(highlightStage.baseColor, heat)).multiplyScalar(stageIntensity);
      total.add(stageColor);
      magnitude += stageIntensity;

      // Identity recolor uses the stage's raw intensity (not tier/heat/pulse-scaled) -- "this
      // part is now the red one" is a state, independent of how hot the heartbeat happens to be
      // reading at this instant.
      stageColor.copy(highlightStage.baseColor).multiplyScalar(intensity);
      identityColor.add(stageColor);
      colorWeight += intensity;
    }

    const material = record.mesh.material as THREE.MeshStandardMaterial;

    // Emissive alone, added on top of this part's real (often near-neutral gray metal)
    // diffuse+specular, reads as a pale wash rather than a vivid color -- the achromatic base
    // dominates the sum. Recoloring the diffuse itself toward the active stage's hue (weighted
    // by how many stages are simultaneously active, for the two-stage crossfade case) is what
    // makes the surface actually read as that color; emissive on top is then just the hot pulse
    // accent, not the sole source of the color.
    if (colorWeight > 0.001) {
      identityColor.multiplyScalar(1 / colorWeight);
      material.color.copy(record.baseMaterialColor).lerp(identityColor, Math.min(colorWeight, 1));
    } else {
      material.color.copy(record.baseMaterialColor);
    }

    material.emissive.copy(total);
    material.emissiveIntensity = 1; // total already carries the full per-stage intensity scaling

    if (magnitude >= 0.01) record.mesh.layers.enable(BLOOM_LAYER);
    else record.mesh.layers.disable(BLOOM_LAYER);
  }
}
