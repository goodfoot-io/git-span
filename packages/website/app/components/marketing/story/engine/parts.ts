// Mesh-name -> visual family mapping for the 129-part V8 engine GLB. Pure data/lookup module —
// no three imports — so it can be unit-reasoned-about and imported from both beats.ts (pure) and
// EngineScene.ts (three-aware) without pulling three into the former.

export type PartFamily = 'structure' | 'frontCover' | 'rotating' | 'aluminum' | 'polymer' | 'rubber' | 'hardware';

// Longest-prefix wins, so a more specific name (e.g. `crankshaftSprocket`) overrides its more
// generic stem (`crankshaft`) without needing an exclusion list. Bolts and nuts are named as
// `<hostPart>Bolt*`/`<hostPart>Nut*` in the source FBX, so their prefixes are listed explicitly
// wherever they're longer than the host part's own prefix — that's what routes them to
// `hardware` instead of inheriting the host's family. All prefixes are matched case-insensitively
// against the mesh name (the model mixes `Coverleft`/`intakeManifoldleft` casing with `CoverRight`).
const FAMILY_PREFIXES: ReadonlyArray<readonly [string, PartFamily]> = [
  ['oilpan', 'structure'],
  ['enginebackcover', 'structure'],
  ['engineblockfront', 'frontCover'],
  ['engineblock', 'structure'],
  ['enginesideboltleft', 'hardware'],
  ['enginesideboltright', 'hardware'],
  ['enginesideleft', 'structure'],
  ['enginesideright', 'structure'],
  ['crankshaftsprocket', 'aluminum'],
  ['crankshaft', 'rotating'],
  ['camshaftsprocket', 'aluminum'],
  ['camshaft', 'rotating'],
  ['pistonbolt', 'hardware'],
  ['pistonnut', 'hardware'],
  ['piston', 'rotating'],
  ['crankholderbolt', 'hardware'],
  ['crankholder', 'rotating'],
  ['rockerarmstick', 'rotating'],
  ['gear', 'aluminum'],
  ['throttlebody', 'aluminum'],
  ['cylinderheadboltleft', 'hardware'],
  ['cylinderheadboltright', 'hardware'],
  ['cylinderheadcoverleft', 'polymer'],
  ['cylinderheadcoverright', 'polymer'],
  ['cylinderheadspringleft', 'aluminum'],
  ['cylinderheadspringright', 'aluminum'],
  ['cylinderheadleft', 'aluminum'],
  ['cylinderheadright', 'aluminum'],
  ['intakemanifoldleft', 'aluminum'],
  ['intakemanifoldright', 'aluminum'],
  ['belt', 'rubber']
];

// Sorted once at module init so familyOf can take the first (longest) match.
const SORTED_FAMILY_PREFIXES = [...FAMILY_PREFIXES].sort((a, b) => b[0].length - a[0].length);

export function familyOf(meshName: string): PartFamily {
  const name = meshName.toLowerCase();
  for (const [prefix, family] of SORTED_FAMILY_PREFIXES) {
    if (name.startsWith(prefix)) return family;
  }
  // Fallback for names outside the verified 129-mesh inventory: fasteners read as hardware,
  // anything else defaults to structural so an unrecognized part still reads as inert.
  if (name.includes('bolt') || name.includes('nut')) return 'hardware';
  return 'structure';
}

export const FAMILY_MATERIAL: Record<PartFamily, { color: string; roughness: number; metalness: number }> = {
  structure: { color: '#e9e4d8', roughness: 0.55, metalness: 0.1 },
  frontCover: { color: '#e9e4d8', roughness: 0.5, metalness: 0.15 },
  rotating: { color: '#565a61', roughness: 0.45, metalness: 0.85 },
  aluminum: { color: '#c9ccce', roughness: 0.38, metalness: 0.9 },
  polymer: { color: '#2b2b2e', roughness: 0.6, metalness: 0.05 },
  rubber: { color: '#1e1e20', roughness: 0.95, metalness: 0 },
  hardware: { color: '#83868b', roughness: 0.4, metalness: 0.9 }
};

// The front accessory drive: the parts that resize together in the `change` beat and fail to
// seat in `failure`. Exact mesh names — these five are unnumbered in the source inventory.
export const FRONT_DRIVE: readonly string[] = [
  'belt',
  'crankshaftSprocket',
  'camshaftSprocket',
  'gear',
  'throttleBody'
];

// The block's front-cover mount, which flags red in `failure` and resizes to meet the front
// drive in `related`.
export const FRONT_MOUNT: readonly string[] = ['engineBlockFront'];
