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

// The "mismatch" part: the one piece that resizes and recolors in place (grows, then cycles
// through the orange/blue/red/green highlight story) over the t-based beats in beats.ts. Exact
// mesh name (post `stripDedupSuffix`). Previously this list held all five front-accessory-drive
// parts (belt, crankshaft/camshaft sprockets, gear, throttleBody); the story now isolates the
// mismatch to a single pair -- `gear` (this list) and `engineBackCover` (FRONT_MOUNT, below) --
// so belt/sprockets/throttleBody render as ordinary static geometry and never resize or glow. The
// name `FRONT_DRIVE` is kept (rather than renamed to something gear-specific) since it's still
// the mesh-name lookup for "the part that resizes" -- EngineScene derives `frontDriveParts` from
// this list's length, so narrowing it to one entry narrows that automatically.
export const FRONT_DRIVE: readonly string[] = ['gear'];

// The mating surface the front drive seats against: shares the gear's orange/red highlight beats
// and resizes to meet the (already-regrown) gear in `related`. Measured empirically (see
// EngineScene.ts's PartRecord build and the node inventory script used to pick it):
// `engineBackCover` is a large flat castIron plate (~95x67 units) sitting at the crank's REAR end
// (assembled Z ~= +65.6), directly adjacent to `gear` (Z ~= +72.3) -- the ring gear visually seats
// against its outward face. This was moved here from `engineBlockFront` (a same-shaped plate at
// the *opposite*, front-drive end, Z ~= -65) because `engineBlockFront` sits buried inside the
// assembly with no unobstructed camera angle, forcing illegible depthTest:false "x-ray" highlight
// hacks. `engineBackCover` is externally visible from the canonical camera angles, so its
// highlights can be ordinary depth-tested overlays -- see `buildHighlightRecords` in
// highlights.ts.
export const FRONT_MOUNT: readonly string[] = ['engineBackCover'];

// `gear`'s baked staging -> assembled displacement doesn't yield a usable explode axis (its own
// raw distance is small relative to its neighbors and its direction isn't reliably "outward"),
// so it interpenetrates its mount instead of clearing it. EngineScene.load() overrides these
// parts' exploded pose: `direction: 'reference'` substitutes the averaged, empirically-outward
// axis of `EXPLODE_DIRECTION_REFERENCE` parts (more robust than hand-picking an axis);
// `direction: 'frontReference'` substitutes the axis of `EXPLODE_DIRECTION_REFERENCE_FRONT`
// instead -- a *second*, independent reference is required because `gear` sits at the crank's
// rear end (needs an outward axis pointing toward +Z) while the front-drive-end parts below sit
// at the opposite end (need an axis pointing toward -Z); one shared reference vector cannot serve
// both. `minDistanceFraction`/`maxDistanceFraction` floor/cap the distance as a fraction of the
// model radius. Keyed by name post `stripDedupSuffix`.
export interface ExplodeOverride {
  readonly direction: 'reference' | 'frontReference' | 'own';
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
  piston008: { direction: 'own', maxDistanceFraction: 0.5 },
  // These three share one baked frame-0 staging sample -- (0, 0, -37) for all three, verified
  // against the GLB -- that sits *closer* to the model centroid than their assembled/seated
  // position (Z ~= -69 to -70, the front-drive end). Reversing that axis (the general algorithm's
  // "staging -> assembled, reversed") therefore points *inward*, toward +Z, not outward: at full
  // explode weight all three flew ~80 units the wrong way, straight past `engineBlockFront` (which
  // explodes correctly, the opposite way) and landed buried inside the cylinder-head/block
  // geometry near the model centroid -- invisible, and visibly clipping through the front plate on
  // the way there. `direction: 'frontReference'` substitutes `engineBlockFront`'s own axis, which
  // reliably points outward (-Z) since its baked raw distance is large (~446, ratio ~5.0 of
  // modelRadius, far more confident than these three's own ~33-38). Distance is left to the
  // general per-part computation (their own raw distance, ~33-38) -- only the direction was wrong.
  belt: { direction: 'frontReference' },
  crankshaftSprocket: { direction: 'frontReference' },
  camshaftSprocket: { direction: 'frontReference' },
  // Fixing the sprockets' *direction* (above) wasn't the whole bug: the long shafts the sprockets
  // mount to are independent parts with their own, independently-computed explode transform, and
  // nothing keeps a shaft's tip from traveling further than the sprocket capping its end -- since
  // assembled, the sprocket sits right at the shaft's front tip, any transform that moves the tip
  // further outward than the sprocket makes the shaft appear to skewer straight through it.
  // `camshaft`'s own raw axis is reliable (rawDistance ~290, direction already ~(0, 0.14, -0.99),
  // close to `camshaftSprocket`'s corrected direction) so only the *distance* needed capping:
  // uncapped, the shaft's front tip (assembled Z ~= -70.7, world half-length ~67.4) explodes to
  // Z ~= -209, ~65 units past camshaftSprocket's own exploded Z ~= -143.6 -- verified against the
  // GLB's baked poses. `maxDistanceFraction: 0.7` keeps the tip at Z ~= -132, a ~11-unit margin
  // short of the sprocket, preserving "sprocket caps the shaft's tip" ordering at every explode
  // weight, the same technique used for gear/engineBackCover and the cylinder-block/head pairs
  // above. `crankshaft`'s own raw distance is ~0 (its baked track never actually moves it, so it
  // fell back to the generic radial-from-centroid direction, which for this part happens to point
  // mostly -Y -- a shaft popping sideways off its own axis rather than pulling outward). Given
  // `crankshaftSprocket` above, `direction: 'frontReference'` both fixes that sideways direction
  // and, combined with the small floored distance the near-zero raw distance already yields
  // (EXPLODE_MIN_FRACTION's floor), keeps the shaft's tip a comfortable ~29 units short of
  // `crankshaftSprocket`'s own exploded position -- no separate distance cap needed there.
  camshaft: { direction: 'own', maxDistanceFraction: 0.7 },
  crankshaft: { direction: 'frontReference' },
  // The mirror of `engineBackCover`'s cap above, for the opposite end of the engine:
  // `engineBlockFront` seats *against* the front-drive stack (belt, both sprockets, and the
  // crankshaft/camshaft tips they mount to) from the inside -- assembled, all of those parts sit
  // outboard of it (their Z is more negative -- further from the model center -- than
  // `engineBlockFront`'s own -65.03). Its own raw fly-in distance is huge (~446, saturating near
  // EXPLODE_MAX_FRACTION) and, uncapped, sends it to Z ~= -201.3 -- past every part in the stack
  // (`crankshaft`'s tip, the least-exterior member, only reaches Z ~= -117.6) -- an impossible
  // pass-through where the front cover ends up *outboard* of the parts that mount to its outside
  // face, verified as visible clipping while it overtakes them mid-transition. `maxDistanceFraction:
  // 0.55` keeps it at Z ~= -110, a comfortable margin short of every front-drive-stack member
  // (~7.6 units short of `crankshaft`'s tip, the tightest case), preserving "the plate stays
  // interior to everything mounted on it" at every explode weight -- the same ordering-invariant
  // technique as `engineBackCover`/`gear`, just applied to the other end of the engine.
  engineBlockFront: { direction: 'own', maxDistanceFraction: 0.55 }
};

// Parts orange-emphasized alongside FRONT_DRIVE (gear) during the pre-highlight pulse
// (frame.preHighlightOrange) without joining that list -- the 8 main piston bodies don't resize
// like the gear does, but they do carry their own red beat (frame.pistonRed) that the
// orange pulse crossfades into. `engineBackCover` deliberately does NOT get this pulse (only gear
// + pistons do) -- exact live mesh names in the GLB (post `stripDedupSuffix`, though none of
// these currently carry a dedup suffix).
export const ORANGE_EMPHASIS: readonly string[] = [
  'piston001',
  'piston002',
  'piston003',
  'piston004',
  'piston005',
  'piston006',
  'piston007',
  'piston008'
];

// Parts whose own baked axis is trusted as "healthy" -- averaged at load time into the direction
// used for EXPLODE_OVERRIDES entries with `direction: 'reference'` (currently just `gear`'s).
// `throttleBody`'s own axis is genuinely reliable (large raw distance, consistently upward).
// `belt` is kept here for historical reasons -- its contribution happens to still land
// `healthyDirection` in a useful place for `gear` (see the +Z component both parts' seats share)
// -- but `belt`'s *own* raw axis is not actually reliable; see `EXPLODE_DIRECTION_REFERENCE_FRONT`
// below and `EXPLODE_OVERRIDES`'s `belt` entry, which override `belt`'s own exploded pose instead
// of trusting this raw axis for itself. Matched by name post `stripDedupSuffix`.
export const EXPLODE_DIRECTION_REFERENCE: readonly string[] = ['belt', 'throttleBody'];

// A second, independent reference direction for `direction: 'frontReference'` overrides --
// required because `gear` (rear end, needs +Z-ish outward) and the front-drive-end parts below
// (need -Z-ish outward) can't share one reference vector; averaging them would cancel out. Only
// `engineBlockFront` is listed: its own baked raw distance is large and unambiguous (~446 units,
// ~5x modelRadius) pointing straight outward (-Z) from the front-drive end, unlike `belt`/
// `crankshaftSprocket`/`camshaftSprocket`'s own axes (see `EXPLODE_OVERRIDES`), so it doesn't need
// averaging with a second part the way `EXPLODE_DIRECTION_REFERENCE` does. Matched by name post
// `stripDedupSuffix`.
export const EXPLODE_DIRECTION_REFERENCE_FRONT: readonly string[] = ['engineBlockFront'];
