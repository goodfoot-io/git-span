import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { deriveScene } from '../scene';
import { engineFrame, HIGHLIGHT_BLUE, HIGHLIGHT_GREEN, HIGHLIGHT_ORANGE, HIGHLIGHT_RED } from './beats';
import { BLOOM_LAYER, blackbodyColor, buildHighlightRecords, pulseWave, updateHighlights } from './highlights';
import type { PartRecord } from './types';

function makePartRecord(colorHex: number): PartRecord {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: colorHex });
  const mesh = new THREE.Mesh(geometry, material);
  const identityPose = () => ({
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(1, 1, 1)
  });
  return {
    mesh,
    assembled: identityPose(),
    exploded: identityPose(),
    family: 'aluminum',
    isFrontDrive: false,
    isMount: false,
    isSeatAdjust: false,
    isOrangeEmphasis: false,
    localSphere: new THREE.Sphere()
  };
}

describe('pulseWave', () => {
  it('is 0 at cycle 0 and cycle 1', () => {
    expect(pulseWave(0)).toBeCloseTo(0, 10);
    expect(pulseWave(1)).toBeCloseTo(0, 10);
  });

  it('is exactly 1 at cycle 0.5', () => {
    expect(pulseWave(0.5)).toBeCloseTo(1, 10);
  });

  it('is symmetric: f(x) === f(1-x)', () => {
    for (const x of [0.1, 0.2, 0.33, 0.4, 0.49]) {
      expect(pulseWave(x)).toBeCloseTo(pulseWave(1 - x), 10);
    }
  });

  it('stays within [0,1] across a full cycle', () => {
    for (let x = 0; x <= 1; x += 0.01) {
      const value = pulseWave(x);
      expect(value).toBeGreaterThanOrEqual(-1e-9);
      expect(value).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe('blackbodyColor', () => {
  const blue = new THREE.Color(HIGHLIGHT_BLUE);
  const red = new THREE.Color(HIGHLIGHT_RED);

  it('is pure: same inputs produce equal colors', () => {
    const a = blackbodyColor(new THREE.Color(HIGHLIGHT_BLUE), 0.4);
    const b = blackbodyColor(new THREE.Color(HIGHLIGHT_BLUE), 0.4);
    expect(a.equals(b)).toBe(true);
  });

  it('clamps heat below 0 to 0', () => {
    const a = blackbodyColor(new THREE.Color(HIGHLIGHT_RED), -1);
    const b = blackbodyColor(new THREE.Color(HIGHLIGHT_RED), 0);
    expect(a.equals(b)).toBe(true);
  });

  it('clamps heat above 1 to 1', () => {
    const a = blackbodyColor(new THREE.Color(HIGHLIGHT_RED), 2);
    const b = blackbodyColor(new THREE.Color(HIGHLIGHT_RED), 1);
    expect(a.equals(b)).toBe(true);
  });

  it('at heat 0, lightness is the ember lightness (0.14), regardless of base hue', () => {
    const hsl = { h: 0, s: 0, l: 0 };
    blackbodyColor(new THREE.Color(HIGHLIGHT_ORANGE), 0).getHSL(hsl);
    expect(hsl.l).toBeCloseTo(0.14, 5);
    blackbodyColor(new THREE.Color(HIGHLIGHT_BLUE), 0).getHSL(hsl);
    expect(hsl.l).toBeCloseTo(0.14, 5);
  });

  it('at heat 1, lightness and saturation reach the tuned hot peak', () => {
    const hsl = { h: 0, s: 0, l: 0 };
    blackbodyColor(new THREE.Color(HIGHLIGHT_BLUE), 1).getHSL(hsl);
    expect(hsl.l).toBeCloseTo(0.52, 5);
    expect(hsl.s).toBeCloseTo(0.92, 5);
  });

  it('hue moves toward the warm/orange hue (30/360) as heat rises from 0 to 0.5', () => {
    const warmHue = 30 / 360;
    const baseHsl = { h: 0, s: 0, l: 0 };
    blue.getHSL(baseHsl);
    const distanceAt = (heat: number) => {
      const hsl = { h: 0, s: 0, l: 0 };
      blackbodyColor(blue, heat).getHSL(hsl);
      return Math.abs(hsl.h - warmHue);
    };
    const d0 = distanceAt(0);
    const d25 = distanceAt(0.25);
    const d50 = distanceAt(0.5);
    expect(d25).toBeLessThan(d0);
    expect(d50).toBeLessThan(d25);
    // Base hue itself should be unchanged from the input at heat 0 (only lightness moves there).
    expect(d0).toBeCloseTo(Math.abs(baseHsl.h - warmHue), 10);
  });

  it('hue holds flat past heat 0.5 (all hue movement happens in the first half)', () => {
    const hsl50 = { h: 0, s: 0, l: 0 };
    const hsl75 = { h: 0, s: 0, l: 0 };
    const hsl100 = { h: 0, s: 0, l: 0 };
    blackbodyColor(blue, 0.5).getHSL(hsl50);
    blackbodyColor(blue, 0.75).getHSL(hsl75);
    blackbodyColor(blue, 1).getHSL(hsl100);
    expect(hsl75.h).toBeCloseTo(hsl50.h, 10);
    expect(hsl100.h).toBeCloseTo(hsl50.h, 10);
  });

  it('retains base-hue identity at low heat: blue stays visibly bluer than red at heat 0.4', () => {
    const blueHsl = { h: 0, s: 0, l: 0 };
    const redHsl = { h: 0, s: 0, l: 0 };
    blackbodyColor(blue, 0.4).getHSL(blueHsl);
    blackbodyColor(red, 0.4).getHSL(redHsl);
    // Red's own hue is already ~0 (adjacent to the warm hue), so it barely moves; blue's hue
    // starts far away and only travels a capped fraction toward warm -- it should remain well
    // above red's resulting hue rather than converging with it.
    expect(blueHsl.h).toBeGreaterThan(redHsl.h + 0.2);
  });
});

describe('buildHighlightRecords', () => {
  it('gear (frontDrive) records carry stages orange -> blue -> ringRed -> finalGreen, in order', () => {
    const gear = makePartRecord(0x123456);
    const records = buildHighlightRecords([gear], null, []);
    expect(records).toHaveLength(1);
    expect(records[0].stages.map((s) => s.kind)).toEqual(['orange', 'blue', 'ringRed', 'finalGreen']);
  });

  it('mount records carry stages orange -> red -> finalGreen, in order', () => {
    const mount = makePartRecord(0x223344);
    const records = buildHighlightRecords([], mount, []);
    expect(records).toHaveLength(1);
    expect(records[0].stages.map((s) => s.kind)).toEqual(['orange', 'red', 'finalGreen']);
  });

  it('each orangeEmphasis (piston) record carries stages orange -> pistonRed -> finalGreen, in order', () => {
    const piston1 = makePartRecord(0x334455);
    const piston2 = makePartRecord(0x445566);
    const records = buildHighlightRecords([], null, [piston1, piston2]);
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record.stages.map((s) => s.kind)).toEqual(['orange', 'pistonRed', 'finalGreen']);
    }
  });

  it('baseMaterialColor equals the material color at build time', () => {
    const gear = makePartRecord(0x4a4d52);
    const [record] = buildHighlightRecords([gear], null, []);
    const material = gear.mesh.material as THREE.MeshStandardMaterial;
    expect(record.baseMaterialColor.equals(material.color)).toBe(true);
  });

  it('baseMaterialColor is a clone -- mutating the material color afterward does not change it', () => {
    const gear = makePartRecord(0x4a4d52);
    const [record] = buildHighlightRecords([gear], null, []);
    const captured = record.baseMaterialColor.clone();
    const material = gear.mesh.material as THREE.MeshStandardMaterial;
    material.color.set(0xffffff);
    expect(record.baseMaterialColor.equals(captured)).toBe(true);
    expect(record.baseMaterialColor.equals(material.color)).toBe(false);
  });

  it('mountPart null yields no mount record', () => {
    const gear = makePartRecord(0x123456);
    const records = buildHighlightRecords([gear], null, []);
    expect(records).toHaveLength(1);
    expect(records[0].stages.map((s) => s.kind)).not.toContain('red');
  });
});

describe('updateHighlights', () => {
  it('an all-zero EngineFrame (t=0) returns material to baseMaterialColor, emissive black, BLOOM_LAYER disabled', () => {
    const gear = makePartRecord(0x4a4d52);
    const records = buildHighlightRecords([gear], null, []);
    const frame = engineFrame(deriveScene(0));

    updateHighlights(records, frame, 0);

    const material = gear.mesh.material as THREE.MeshStandardMaterial;
    expect(material.color.equals(records[0].baseMaterialColor)).toBe(true);
    expect(material.emissive.equals(new THREE.Color(0, 0, 0))).toBe(true);
    expect(gear.mesh.layers.isEnabled(BLOOM_LAYER)).toBe(false);
  });

  it('frame.finalGreen = 1 (t=100) recolors toward the green identity, lights emissive, enables BLOOM_LAYER', () => {
    const gear = makePartRecord(0x4a4d52);
    const records = buildHighlightRecords([gear], null, []);
    const frame = engineFrame(deriveScene(100));
    expect(frame.finalGreen).toBe(1);
    // Every other stage weight on the gear (orange/blue/ringRed) should be 0 at t=100, so the
    // color moves fully to the green identity -- not a partial blend.
    expect(frame.preHighlightOrange).toBe(0);
    expect(frame.blue).toBe(0);
    expect(frame.ringRed).toBe(0);

    updateHighlights(records, frame, 0);

    const material = gear.mesh.material as THREE.MeshStandardMaterial;
    expect(material.color.equals(new THREE.Color(HIGHLIGHT_GREEN))).toBe(true);
    expect(material.emissive.equals(new THREE.Color(0, 0, 0))).toBe(false);
    expect(gear.mesh.layers.isEnabled(BLOOM_LAYER)).toBe(true);
  });

  it('pulseWeight changes emissive magnitude but never material.color (identity recolor is pulse-independent)', () => {
    const frame = engineFrame(deriveScene(100));

    const gearAtRest = makePartRecord(0x4a4d52);
    const recordsAtRest = buildHighlightRecords([gearAtRest], null, []);
    updateHighlights(recordsAtRest, frame, 0);

    const gearAtPeak = makePartRecord(0x4a4d52);
    const recordsAtPeak = buildHighlightRecords([gearAtPeak], null, []);
    updateHighlights(recordsAtPeak, frame, 1);

    const materialAtRest = gearAtRest.mesh.material as THREE.MeshStandardMaterial;
    const materialAtPeak = gearAtPeak.mesh.material as THREE.MeshStandardMaterial;

    expect(materialAtRest.color.equals(materialAtPeak.color)).toBe(true);

    const magnitude = (c: THREE.Color) => c.r + c.g + c.b;
    expect(magnitude(materialAtPeak.emissive)).toBeGreaterThan(magnitude(materialAtRest.emissive));
  });
});
