// The mismatch bounding-box prop: three translucent green glass containers that fade in around
// just the mismatch story's own parts while every highlight is dark, and fade back out as those
// parts resolve to the shared green. Pure besides the `three` types it operates on -- holds no
// mutable module state; the THREE.Group instances themselves live in EngineScene.
import * as THREE from 'three';
import { HIGHLIGHT_GREEN } from './beats';
import type { PartRecord } from './types';

// --- Mismatch bounding boxes -----------------------------------------------------------------
// Three translucent green glass containers that fade in around the mismatch story's own parts
// (gear + engineBackCover, and the 8 pistons split into their two banks) while every highlight is
// dark (frame.boxWeight, ~t46-60 peaking at 60), and fade back out as those parts resolve to the
// shared green (~t60-72). This used to be a single axis-aligned box around every mismatch part at
// once, but that box had to be sized to the union of the ring (gear + engineBackCover) and all 8
// pistons across both cylinder banks -- and an axis-aligned box around a V8's tilted piston banks
// (each bank sits at roughly a +-45 degree tilt about the crankshaft axis) reads as loose and
// baggy, since it has to be big enough to clear the tilted corners, leaving large empty wedges of
// "glass" that don't actually contain anything. Splitting into a ring container (still axis-
// aligned -- gear/engineBackCover aren't tilted) plus one ORIENTED container per bank (see
// orientedBankBounds) lets each box hug its contents snugly instead. Fixed props like before:
// sized/positioned/oriented once at load time from the parts' exploded pose (see
// computeMismatchBoxBounds) rather than tracked live, since explode is held flat for this entire
// window -- nothing any of them encloses moves.
export const BOUNDING_BOX_MAX_OPACITY = 0.45;
export const BOUNDING_BOX_EDGE_OPACITY = 0.7;
export const BOUNDING_BOX_PADDING = 1.02;
// The fill's own tint runs much deeper than HIGHLIGHT_GREEN: the canvas is alpha-composited over
// the cream page, so the only way the glass can *darken and tint* what's behind it (the way real
// colored glass does) is opacity x a deep color -- at glass-level opacity the mint highlight
// green just washes out to near-white. The edges stay on the shared highlight color.
export const BOUNDING_BOX_GLASS_GREEN = '#0c8a60';

// A single container's world placement: a center plus a size measured along an orthonormal frame,
// and the quaternion that frame corresponds to. The ring container doesn't tilt (identity
// quaternion, frame = world axes); the two bank containers do -- one shape serves both, so
// buildGlassBoxGroup doesn't need to special-case either.
export interface OrientedBoxBounds {
  readonly center: THREE.Vector3;
  readonly size: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
}

export interface MismatchBoxBounds {
  readonly ring: OrientedBoxBounds;
  readonly leftBank: OrientedBoxBounds;
  readonly rightBank: OrientedBoxBounds;
}

// Parts feeding the three containers: `ring` is the gear + engineBackCover pair (a small, axis-
// aligned box -- same construction as the original single box, just restricted to those two
// parts); `pistons` is all 8 piston bodies across both banks -- computeMismatchBoxBounds splits
// them into their two banks internally (see splitPistonBanks) rather than requiring the caller to
// already know bank membership.
export interface MismatchBoxParts {
  readonly ring: PartRecord[];
  readonly pistons: PartRecord[];
}

// Bank membership isn't encoded in the mesh names (piston001..008 don't say which bank they're
// in), so it's derived from the exploded pose data instead: for each world axis (x, y, z), sort
// the 8 piston centers along that axis and find the widest gap between consecutive values,
// normalized by that axis's own overall range. Whichever axis produces the widest *relative* gap
// is the axis the two banks are separated along (for this V8, empirically x) -- picking the axis
// this way, rather than hardcoding x, keeps the split correct even if the rig's axis convention
// ever changes. The two piston groups on either side of that gap's midpoint are the two banks.
function splitPistonBanks(pistons: readonly PartRecord[]): [PartRecord[], PartRecord[]] {
  const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
  let bestAxis: 'x' | 'y' | 'z' = 'x';
  let bestScore = -Infinity;
  let bestThreshold = 0;
  for (const axis of axes) {
    const values = pistons.map((part) => part.exploded.position[axis]).sort((a, b) => a - b);
    const range = values[values.length - 1] - values[0];
    if (range < 1e-6) continue;
    for (let i = 1; i < values.length; i++) {
      const gap = values[i] - values[i - 1];
      const score = gap / range;
      if (score > bestScore) {
        bestScore = score;
        bestAxis = axis;
        bestThreshold = (values[i] + values[i - 1]) / 2;
      }
    }
  }

  const low: PartRecord[] = [];
  const high: PartRecord[] = [];
  for (const part of pistons) {
    (part.exploded.position[bestAxis] < bestThreshold ? low : high).push(part);
  }
  // "left"/"right" below just means "the lower cluster"/"the higher cluster" along whichever axis
  // won above -- a stable, arbitrary label rather than a verified real-world handedness. Nothing
  // downstream cares which physical side is which, only that the two containers don't share
  // pistons.
  return [low, high];
}

// The direction a bank's pistons travel (their bore axis): each piston's local "up" (0,1,0)
// rotated by its own exploded orientation, averaged across the bank and renormalized -- averaging
// smooths out the small per-piston orientation noise the baked rig carries. Falls back to the
// bank's mean exploded-minus-assembled offset (the direction the explode step pushed the pistons)
// if the averaged "up" vectors happen to cancel out, since that offset also points along the bore
// -- the pistons were pushed straight out along it.
function computeBoreAxis(bank: readonly PartRecord[]): THREE.Vector3 {
  const axis = new THREE.Vector3();
  const localUp = new THREE.Vector3(0, 1, 0);
  for (const part of bank) {
    axis.add(localUp.clone().applyQuaternion(part.exploded.quaternion));
  }
  if (axis.lengthSq() < 1e-8) {
    axis.set(0, 0, 0);
    for (const part of bank) axis.add(part.exploded.position.clone().sub(part.assembled.position));
  }
  return axis.lengthSq() < 1e-8 ? new THREE.Vector3(0, 1, 0) : axis.normalize();
}

// The crankshaft direction a bank's 4 pistons are spread along, orthogonalized against the bore
// axis: build an arbitrary orthonormal (u, v) basis spanning the plane perpendicular to the bore
// (the spread direction has to live in that plane -- it's perpendicular to the direction the
// pistons travel), then take the closed-form largest eigenvector of the 4 piston centers' 2x2
// covariance within that plane. That's the principal spread direction, i.e. the crankshaft axis.
function computeCrankAxis(bank: readonly PartRecord[], bore: THREE.Vector3): THREE.Vector3 {
  const center = new THREE.Vector3();
  for (const part of bank) center.add(part.exploded.position);
  center.divideScalar(bank.length);

  const seed = Math.abs(bore.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(seed, bore).normalize();
  const v = new THREE.Vector3().crossVectors(bore, u).normalize();

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const part of bank) {
    const offset = part.exploded.position.clone().sub(center);
    const x = offset.dot(u);
    const y = offset.dot(v);
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const crank = u
    .clone()
    .multiplyScalar(Math.cos(angle))
    .add(v.clone().multiplyScalar(Math.sin(angle)));
  return crank.lengthSq() < 1e-8 ? u : crank.normalize();
}

// Bounds for one piston bank, expressed in an ORIENTED frame rather than world axes -- an
// axis-aligned box around a tilted row of 4 pistons reads as baggy (see the top-of-file comment),
// so this box is instead tilted to match the bank. The frame is (bore, crank, lateral): bore is
// the direction the pistons travel (computeBoreAxis), crank is the direction the 4 pistons are
// spread along (computeCrankAxis), and lateral is whatever's left (their cross product). `bore`
// and `crank` are only approximately orthogonal on input (both are independently estimated from
// noisy baked pose data), so lateral is derived first and crank is then re-derived from
// (lateral, bore) -- that makes the final (bore, crankOrtho, lateral) triple exactly orthonormal
// rather than merely close, which matters below since bounds are reconstructed from it without a
// matrix inverse. Assumes the caller has already snapped the bank's meshes to their exploded pose
// (see computeMismatchBoxBounds) -- matrixWorld is read directly.
function orientedBankBounds(bank: readonly PartRecord[]): OrientedBoxBounds {
  const bore = computeBoreAxis(bank);
  const crank = computeCrankAxis(bank, bore);
  const lateral = new THREE.Vector3().crossVectors(bore, crank).normalize();
  const crankOrtho = new THREE.Vector3().crossVectors(lateral, bore).normalize();

  // Bounds come from each piston's own geometry bounding box, corners transformed by matrixWorld
  // and then re-expressed in the (bore, crankOrtho, lateral) frame via dot products -- the same
  // "use the real geometry, not a bounding sphere" approach the original single box used, just
  // measured along a rotated frame instead of world axes.
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const worldCorner = new THREE.Vector3();
  for (const part of bank) {
    part.mesh.geometry.computeBoundingBox();
    const box = part.mesh.geometry.boundingBox!;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          worldCorner.set(x, y, z).applyMatrix4(part.mesh.matrixWorld);
          const fx = worldCorner.dot(bore);
          const fy = worldCorner.dot(crankOrtho);
          const fz = worldCorner.dot(lateral);
          min.set(Math.min(min.x, fx), Math.min(min.y, fy), Math.min(min.z, fz));
          max.set(Math.max(max.x, fx), Math.max(max.y, fy), Math.max(max.z, fz));
        }
      }
    }
  }

  const localSize = new THREE.Vector3().subVectors(max, min);
  const localCenter = new THREE.Vector3().addVectors(max, min).multiplyScalar(0.5);
  // (bore, crankOrtho, lateral) is a complete orthonormal basis of world space, so the local-frame
  // center reconstructs exactly as a weighted sum of the three axes -- no matrix inverse needed.
  const center = bore
    .clone()
    .multiplyScalar(localCenter.x)
    .addScaledVector(crankOrtho, localCenter.y)
    .addScaledVector(lateral, localCenter.z);

  // Same sliver-of-padding rationale as the ring container below -- tight, not loose.
  const size = new THREE.Vector3(
    Math.max(localSize.x, 1e-3) * BOUNDING_BOX_PADDING,
    Math.max(localSize.y, 1e-3) * BOUNDING_BOX_PADDING,
    Math.max(localSize.z, 1e-3) * BOUNDING_BOX_PADDING
  );

  // makeBasis(bore, crankOrtho, lateral) puts bore/crankOrtho/lateral on the local x/y/z axes
  // respectively -- orientedBankBounds's corner projection above (dot with bore -> fx, crankOrtho
  // -> fy, lateral -> fz) has to agree with that same axis assignment, since the BoxGeometry built
  // from `size` in buildGlassBoxGroup is unrotated in its own local space.
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(bore, crankOrtho, lateral)
  );

  return { center, size, quaternion };
}

// Bounds for the ring container (gear + engineBackCover) -- axis-aligned, exactly like the
// original single box was, just restricted to these two parts instead of all 8 mismatch parts.
// Assumes the caller has already snapped these meshes to their exploded pose.
function axisAlignedBounds(parts: readonly PartRecord[]): OrientedBoxBounds {
  const bounds = new THREE.Box3();
  const partBounds = new THREE.Box3();
  for (const part of parts) {
    part.mesh.geometry.computeBoundingBox();
    partBounds.copy(part.mesh.geometry.boundingBox!).applyMatrix4(part.mesh.matrixWorld);
    bounds.union(partBounds);
  }
  const size = new THREE.Vector3();
  bounds.getSize(size);
  const center = new THREE.Vector3();
  bounds.getCenter(center);
  return { center, size, quaternion: new THREE.Quaternion() };
}

// Computes bounds for all three containers from the parts' *exploded* pose (position/quaternion/
// scale, no live mesh state needed) since explode is held flat at 1 for this entire window (see
// beats.ts's explodeAt) -- nothing any of the three containers encloses moves. Temporarily snaps
// every relevant mesh to its exploded pose to read world-space bounds, then restores every mesh to
// its construction-time assembled pose (the real pose gets applied by the first setFrame call
// regardless, but leaving stale exploded-pose meshes around in the meantime risks a mismatched
// flash before that first frame lands). Snapping/restoring happens once here, around all three
// bounds computations, rather than once per container -- three redundant snap/settle/restore round
// trips over the same meshes would be wasted work for no benefit.
export function computeMismatchBoxBounds(parts: MismatchBoxParts, group: THREE.Group): MismatchBoxBounds {
  const [leftBank, rightBank] = splitPistonBanks(parts.pistons);
  const allParts = [...parts.ring, ...parts.pistons];

  for (const part of allParts) {
    part.mesh.position.copy(part.exploded.position);
    part.mesh.quaternion.copy(part.exploded.quaternion);
    part.mesh.scale.copy(part.exploded.scale);
  }
  group.updateMatrixWorld(true);

  const ring = axisAlignedBounds(parts.ring);
  const leftBankBounds = orientedBankBounds(leftBank);
  const rightBankBounds = orientedBankBounds(rightBank);

  for (const part of allParts) {
    part.mesh.position.copy(part.assembled.position);
    part.mesh.quaternion.copy(part.assembled.quaternion);
    part.mesh.scale.copy(part.assembled.scale);
  }
  group.updateMatrixWorld(true);

  return { ring, leftBank: leftBankBounds, rightBank: rightBankBounds };
}

// One glass container: a padded box (BOUNDING_BOX_PADDING) sized/centered/oriented to `bounds`,
// with the same lit MeshPhysicalMaterial fill + EdgesGeometry outline every container shares.
// Group layout is fixed -- first child the fill mesh, second the edge outline -- see
// updateBoundingBox, which relies on that order for every container.
//
// The lit glass fill already shades by face orientation, but its opacity is low enough that the
// silhouette can still get lost against busy parts behind it -- an EdgesGeometry outline drawn on
// top keeps the corners crisp so each container reads as a bounded volume rather than a blob.
function buildGlassBoxGroup(bounds: OrientedBoxBounds): THREE.Group {
  // A sliver of padding so the box clears its contents' exact silhouette without reading as
  // loose -- it should tightly contain its parts, not float around them.
  const geometry = new THREE.BoxGeometry(bounds.size.x, bounds.size.y, bounds.size.z);
  // Green glass, not a flat wash: a lit physical material picks up the scene's HDRI environment
  // and key light, so the faces carry a specular sheen and angle-dependent shading (clearcoat for
  // the polished-glass gloss) while staying genuinely translucent via low opacity. DoubleSide is
  // deliberate -- seeing the box's far faces through the near ones is what sells a glass volume.
  const material = new THREE.MeshPhysicalMaterial({
    color: BOUNDING_BOX_GLASS_GREEN,
    metalness: 0,
    roughness: 0.12,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false // story UI, not part of the physical scene -- must not veil with depth
  });
  const fill = new THREE.Mesh(geometry, material);

  const edgesMaterial = new THREE.LineBasicMaterial({
    color: HIGHLIGHT_GREEN,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false
  });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgesMaterial);

  const group = new THREE.Group();
  group.add(fill, edges);
  group.position.copy(bounds.center);
  group.quaternion.copy(bounds.quaternion);
  return group;
}

// The three-container prop: a single parent THREE.Group whose children are the ring container
// (axis-aligned, gear + engineBackCover) and the two piston-bank containers (oriented, see
// orientedBankBounds). EngineScene keeps treating `this.boundingBox` as one group -- scene.add,
// the bloom-pass visible toggle, and the per-frame opacity update (updateBoundingBox) all still
// operate on this parent -- it just now has three sub-groups as children instead of being the box
// itself.
export function buildMismatchBoxes(bounds: MismatchBoxBounds): THREE.Group {
  const group = new THREE.Group();
  group.add(buildGlassBoxGroup(bounds.ring), buildGlassBoxGroup(bounds.leftBank), buildGlassBoxGroup(bounds.rightBank));
  group.visible = false;
  return group;
}

// The containers are fixed props (see computeMismatchBoxBounds/buildMismatchBoxes) -- only their
// opacity/visibility respond to the frame, applied identically to all three so they read as one
// consistent glass material rather than three independently-timed props. Deliberately untouched
// by pulseWeight/pulseWave -- the mismatch boxes are steady static props, not one of the pulsing
// highlights.
export function updateBoundingBox(box: THREE.Group | null, boxWeight: number): void {
  if (!box) return;
  for (const container of box.children as THREE.Group[]) {
    const [fill, edges] = container.children as [THREE.Mesh, THREE.LineSegments];
    const fillMaterial = fill.material as THREE.MeshPhysicalMaterial;
    const edgesMaterial = edges.material as THREE.LineBasicMaterial;
    fillMaterial.opacity = boxWeight * BOUNDING_BOX_MAX_OPACITY;
    // The outline reads clearly at a much lower opacity than the fill needs for its wash -- pushed
    // well above the fill's own weight so each container's edges stay crisp even while the fill is
    // faint.
    edgesMaterial.opacity = boxWeight * BOUNDING_BOX_EDGE_OPACITY;
  }
  box.visible = boxWeight >= 0.01;
}
