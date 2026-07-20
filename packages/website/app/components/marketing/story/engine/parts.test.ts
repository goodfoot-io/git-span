import { describe, expect, it } from 'vitest';
import { FRONT_DRIVE, familyOf, ORANGE_EMPHASIS, stripDedupSuffix } from './parts';

describe('stripDedupSuffix', () => {
  it('strips a trailing underscore + digits suffix', () => {
    expect(stripDedupSuffix('gear_1')).toBe('gear');
    expect(stripDedupSuffix('belt_12')).toBe('belt');
  });

  it('leaves digit suffixes without an underscore unchanged', () => {
    expect(stripDedupSuffix('piston001')).toBe('piston001');
  });

  it('leaves names with no suffix unchanged', () => {
    expect(stripDedupSuffix('engineBackCover')).toBe('engineBackCover');
  });
});

describe('familyOf', () => {
  it('picks the longest matching prefix', () => {
    expect(familyOf('crankshaftSprocket')).toBe('aluminum');
    expect(familyOf('crankshaft')).toBe('rotating');
    expect(familyOf('pistonBolt001')).toBe('hardware');
    expect(familyOf('piston001')).toBe('rotating');
    expect(familyOf('engineBlockFront')).toBe('frontCover');
    expect(familyOf('engineBlock')).toBe('castIron');
  });

  it('matches case-insensitively', () => {
    expect(familyOf('cylinderHeadCoverleft')).toBe('polymer');
    expect(familyOf('CylinderHeadCoverLeft')).toBe('polymer');
    expect(familyOf('intakeManifoldleft')).toBe('aluminum');
    expect(familyOf('INTAKEMANIFOLDLEFT')).toBe('aluminum');
  });

  it('falls back to hardware for unrecognized bolt/nut names', () => {
    expect(familyOf('mysteryBolt3')).toBe('hardware');
  });

  it('falls back to castIron for anything else unrecognized', () => {
    expect(familyOf('unknownThing')).toBe('castIron');
  });
});

describe('membership lists', () => {
  it('FRONT_DRIVE is exactly [gear]', () => {
    expect(FRONT_DRIVE).toEqual(['gear']);
  });

  it('ORANGE_EMPHASIS is exactly piston001..piston008', () => {
    expect(ORANGE_EMPHASIS).toEqual([
      'piston001',
      'piston002',
      'piston003',
      'piston004',
      'piston005',
      'piston006',
      'piston007',
      'piston008'
    ]);
  });
});
