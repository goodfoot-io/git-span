// Mesh-name -> visual family mapping for the 129-part V8 engine GLB. Pure data/lookup module —
// no three imports — so it can be unit-reasoned-about and imported from both beats.ts (pure) and
// EngineScene.ts (three-aware) without pulling three into the former.

export type PartFamily =
  | 'castIronDark'
  | 'castIron'
  | 'castIronLight'
  | 'frontCover'
  | 'rotating'
  | 'aluminum'
  | 'polymer'
  | 'rubber'
  | 'hardware';

// Longest-prefix wins, so a more specific name (e.g. `crankshaftSprocket`) overrides its more
// generic stem (`crankshaft`) without needing an exclusion list. Bolts and nuts are named as
// `<hostPart>Bolt*`/`<hostPart>Nut*` in the source FBX, so their prefixes are listed explicitly
// wherever they're longer than the host part's own prefix — that's what routes them to
// `hardware` instead of inheriting the host's family. All prefixes are matched case-insensitively
// against the mesh name (the model mixes `Coverleft`/`intakeManifoldleft` casing with `CoverRight`).
const FAMILY_PREFIXES: ReadonlyArray<readonly [string, PartFamily]> = [
  ['oilpan', 'castIronDark'],
  ['enginebackcover', 'castIron'],
  ['engineblockfront', 'frontCover'],
  ['engineblock', 'castIron'],
  ['enginesideboltleft', 'hardware'],
  ['enginesideboltright', 'hardware'],
  ['enginesideleft', 'castIronLight'],
  ['enginesideright', 'castIronLight'],
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
  // anything else defaults to the block's own cast iron so an unrecognized part still reads as
  // an inert casting rather than a mismatched material.
  if (name.includes('bolt') || name.includes('nut')) return 'hardware';
  return 'castIron';
}

export const FAMILY_MATERIAL: Record<PartFamily, { color: string; roughness: number; metalness: number }> = {
  // The structure family is split into three cast-iron variants so the engine's mass reads as
  // assembled castings rather than one uniform material: a darker sand-cast oil pan, the block
  // and back cover as the "base" graphite iron, and slightly lighter side covers.
  castIronDark: { color: '#3f4247', roughness: 0.65, metalness: 0.8 },
  castIron: { color: '#4a4d52', roughness: 0.6, metalness: 0.85 },
  castIronLight: { color: '#54575d', roughness: 0.55, metalness: 0.85 },
  frontCover: { color: '#e9e4d8', roughness: 0.5, metalness: 0.15 },
  rotating: { color: '#565a61', roughness: 0.45, metalness: 0.85 },
  aluminum: { color: '#c9ccce', roughness: 0.38, metalness: 0.9 },
  polymer: { color: '#2b2b2e', roughness: 0.6, metalness: 0.05 },
  rubber: { color: '#1e1e20', roughness: 0.95, metalness: 0 },
  hardware: { color: '#83868b', roughness: 0.4, metalness: 0.9 }
};

// A handful of source meshes share their name with the wrapper group node the exporter placed
// them under (`belt`'s group and `belt`'s own mesh, for instance). GLTFLoader's name
// deduplication then suffixes the *second* claimant of the name with `_<n>` (`belt` -> `belt_1`)
// -- so the mesh actually rendered can carry a name FRONT_DRIVE/FRONT_MOUNT/EXPLODE_OVERRIDES
// don't literally list. Every exact-name lookup against a live mesh name in this module strips
// that suffix first so the logical part name (`belt`, not `belt_1`) is what's compared.
export function stripDedupSuffix(meshName: string): string {
  return meshName.replace(/_\d+$/, '');
}

// The "mismatch" part: the one piece that resizes and lifts off its seat in the `change` beat
// and fails to seat in `failure`. Exact mesh name (post `stripDedupSuffix`). Previously this list
// held all five front-accessory-drive parts (belt, crankshaft/camshaft sprockets, gear,
// throttleBody); the story now isolates the mismatch to a single pair -- `gear` (this list) and
// `engineBackCover` (FRONT_MOUNT, below) -- so belt/sprockets/throttleBody render as ordinary
// static geometry and never highlight, resize, or lift. The name `FRONT_DRIVE` is kept (rather
// than renamed to something gear-specific) since it's still the mesh-name lookup for "the part
// that resizes" -- EngineScene derives `frontDriveParts`/highlight-shell/linkage counts from
// this list's length, so narrowing it to one entry narrows those automatically.
export const FRONT_DRIVE: readonly string[] = ['gear'];

// The mating surface the front drive fails to seat onto: flags red in `failure` and resizes to
// meet the front drive in `related`. Measured empirically (see EngineScene.ts's PartRecord
// build and the node inventory script used to pick it): `engineBackCover` is a large flat
// castIron plate (~95x67 units) sitting at the crank's REAR end (assembled Z ~= +65.6), directly
// adjacent to `gear` (Z ~= +72.3) -- the ring gear visually seats against its outward face. This
// was moved here from `engineBlockFront` (a same-shaped plate at the *opposite*, front-drive end,
// Z ~= -65) because `engineBlockFront` sits buried inside the assembly with no unobstructed
// camera angle, forcing illegible depthTest:false "x-ray" highlight hacks. `engineBackCover` is
// externally visible from the canonical camera angles, so its highlights can be ordinary
// depth-tested overlays -- see `buildHighlightShells` in EngineScene.ts.
export const FRONT_MOUNT: readonly string[] = ['engineBackCover'];

// `gear` is FRONT_DRIVE's only member and the one physically adjacent to the (rear-mounted)
// FRONT_MOUNT, so it's the only part whose assembled seat target remaps radially about the
// mount's center as the mount grows (`related`/`success`'s seatAdjust). Matched by name post
// `stripDedupSuffix`.
export const FRONT_DRIVE_SEAT_ADJUST: readonly string[] = ['gear'];

// `gear`'s baked staging -> assembled displacement doesn't yield a usable explode axis (its own
// raw distance is small relative to its neighbors and its direction isn't reliably "outward"),
// so it interpenetrates its mount instead of clearing it. EngineScene.load() overrides these
// parts' exploded pose: `direction: 'reference'` substitutes the averaged, empirically-outward
// axis of `EXPLODE_DIRECTION_REFERENCE` parts (more robust than hand-picking an axis);
// `minDistanceFraction`/`maxDistanceFraction` floor/cap the distance as a fraction of the model
// radius. Keyed by name post `stripDedupSuffix`.
export interface ExplodeOverride {
  readonly direction: 'reference' | 'own';
  readonly minDistanceFraction?: number;
  readonly maxDistanceFraction?: number;
}

export const EXPLODE_OVERRIDES: Readonly<Record<string, ExplodeOverride>> = {
  gear: { direction: 'reference', minDistanceFraction: 0.9 },
  // The gear seats against this cover from the outside; assembled, the gear is the outboard
  // part. The cover's huge raw fly-in distance saturates it near EXPLODE_MAX_FRACTION, which
  // would carry it past the gear's exploded seat -- an impossible pass-through, visible as
  // clipping while the two cross mid-transition (worst in `second`, where the cover re-explodes
  // its full travel but the gear only its post-stall half). Capping the cover's travel keeps
  // gear-outside ordering at every blend weight of both curves. (Both fractions are net x1.8 of
  // their original 0.5/0.35 values -- x3 from the earlier tripling, then x0.6 from the explode-
  // distance reduction that shrunk EngineScene.ts's EXPLODE_MIN/MAX_FRACTION -- scaling every
  // distance in the pair by the same running factor preserves the ordering invariant.)
  engineBackCover: { direction: 'own', maxDistanceFraction: 0.63 },
  // Each cylinder bank's block casting sits directly beneath its cylinder head (assembled Y ~=
  // 12.4 vs 26.5) but its raw staging->assembled distance is ~180-200 units -- much larger than
  // the head's ~120 -- and its raw direction leans a few degrees further sideways than the head's.
  // Uncapped, the general per-part compression (`rawDistance / (rawDistance + modelRadius)`
  // saturated into [EXPLODE_MIN_FRACTION..EXPLODE_MAX_FRACTION]) sends the block *past* the head
  // along that diverging axis, so partway through the explode/re-explode ramp the darker castIron
  // block overtakes the lighter aluminum head's silhouette -- visible clipping reported as "the
  // darker piece below interfering with the lighter metal above." Capping the block's own-axis
  // distance below the head's own ~1.3x-modelRadius keeps the head clearly outboard of its block
  // at every explode weight, the same ordering-invariant technique used for gear/engineBackCover
  // above (see that entry's comment).
  engineBlockCylinderLeft: { direction: 'own', maxDistanceFraction: 1.0 },
  engineBlockCylinderRight: { direction: 'own', maxDistanceFraction: 1.0 },
  // The 8 main piston bodies (piston001-008) each carry an anomalously huge raw staging->assembled
  // distance (270-704 units, vs ~120-200 for their neighbors) -- the same "unreliable baked
  // fly-in" trap documented for `gear` above, just showing up as an outsized distance rather than
  // an unreliable direction. Their own direction IS trustworthy (it consistently matches their
  // bank's cylinderHead/engineBlockCylinder axis), so this only floors/caps distance, it doesn't
  // override direction. Uncapped, every piston in a bank saturates near EXPLODE_MAX_FRACTION and
  // converges on nearly the same point regardless of which of the 4 cylinders it belongs to --
  // landing inside (and rendering embedded in) that bank's cylinderHead, which is the "piston
  // showing through the lighter aluminum head" clipping the block-cap-only fix (see
  // engineBlockCylinderLeft/Right above) didn't address. Capped well under both the block's own
  // 1.0 cap and the head's ~1.3 effective fraction so the piston cluster reads as nested behind
  // both along the shared bank axis instead of overtaking either.
  piston001: { direction: 'own', maxDistanceFraction: 0.5 },
  piston002: { direction: 'own', maxDistanceFraction: 0.5 },
  piston003: { direction: 'own', maxDistanceFraction: 0.5 },
  piston004: { direction: 'own', maxDistanceFraction: 0.5 },
  piston005: { direction: 'own', maxDistanceFraction: 0.5 },
  piston006: { direction: 'own', maxDistanceFraction: 0.5 },
  piston007: { direction: 'own', maxDistanceFraction: 0.5 },
  piston008: { direction: 'own', maxDistanceFraction: 0.5 }
};

// Parts whose own baked axis is trusted as "healthy" -- averaged at load time into the direction
// used for EXPLODE_OVERRIDES entries (currently just `gear`'s). `belt`/`throttleBody` are no
// longer part of the mismatch story (see FRONT_DRIVE above) but still render as ordinary static
// geometry with reliable baked axes, so they remain the reference pair. Matched by name post
// `stripDedupSuffix`.
export const EXPLODE_DIRECTION_REFERENCE: readonly string[] = ['belt', 'throttleBody'];
