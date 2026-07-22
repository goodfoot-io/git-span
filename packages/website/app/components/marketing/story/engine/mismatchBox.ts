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
// The ring container (gear + engineBackCover) needs more headroom than the snug bank boxes:
// the glass boxes fade in over frame.boxWeight's t58-60 window, which overlaps the TAIL of the
// gear's oversized-mismatch shrink-back ramp (beats.ts's COLOR_LOSS window, ~t46-60) -- at t58-59
// the gear is typically still ~85-95% through that ramp, so it's still carrying a residual few
// percent of its FRONT_SCALE (1.25x) growth right as the box becomes visible. The ring box is
// sized from the gear's UNSCALED (scaleFactor === 1) exploded geometry, so that residual oversize
// has no padding budget to hide in unless the box itself is given real headroom -- 1.08 clears a
// worst-case ~4% residual oversize with margin while still reading as a tight-fitting container,
// not a loose one. (The box is deliberately a static prop -- see computeMismatchBoxBounds -- so
// this is a fixed allowance sized for the worst moment in the fade-in window, not a live fit.)
export const RING_BOX_PADDING = 1.08;
// The ring box was still clipping the gear at the front (along the crank axis) even with
// RING_BOX_PADDING's uniform 1.08 -- the gear/engineBackCover pair's extent along the crank axis
// needs more headroom than its other two axes, not more headroom everywhere (uniform padding just
// makes the whole box bigger without fixing the one direction that was actually tight). Applied
// ONLY to the crank-axis dimension in axisAlignedBounds; the other two axes keep RING_BOX_PADDING.
export const RING_BOX_AXIAL_PADDING = 1.16;
// The fill's own tint runs much deeper than HIGHLIGHT_GREEN: the canvas is alpha-composited over
// the cream page, so the only way the glass can *darken and tint* what's behind it (the way real
// colored glass does) is opacity x a deep color -- at glass-level opacity the mint highlight
// green just washes out to near-white. The edges stay on the shared highlight color. Hued to
// match HIGHLIGHT_GREEN / --color-positive exactly (135.95°, see global.css), keeping this
// token's own deeper S/L.
export const BOUNDING_BOX_GLASS_GREEN = '#0c8a2d';

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

// --- Geometry-derived centers/axes -----------------------------------------------------------
// This GLB's baked FBX pivots are arbitrary (a mesh's local origin rarely sits at its physical
// center) and its per-part orientation/tilt live in the VERTEX DATA, not in any consistent local
// axis convention -- many meshes carry an identity or near-identity rotation despite visibly
// tilted geometry (the V8's ~+-45 degree bank tilt among them). Two derivations that assumed
// otherwise -- using `assembled.position` (the mesh origin) as a stand-in for "where a part
// physically is," and rotating a fixed local axis by a mesh's own quaternion to find which way it
// points -- were both empirically wrong and produced axis-aligned "oriented" boxes and pistons
// that stroked vertically instead of along their bore. Every axis and pivot in this module is
// therefore derived from the actual baked GEOMETRY (the mesh's own bounding box, transformed by
// its assembled TRS) instead.

// A part's world-space geometry bounding box at its ASSEMBLED pose: the geometry's local bbox
// corners, transformed by a TRS matrix composed fresh from assembled position/quaternion/scale
// (never read off the mesh's own current/live pose, which may be mid-explode), re-enclosed in a
// new world-axis-aligned box. Used for both a part's geometric center (assembledGeometricCenter,
// below) and, for the crankshaft specifically, to find its dominant world axis (see
// EngineScene.ts's load(), where the crank line is derived).
export function assembledWorldBox(part: PartRecord): THREE.Box3 {
  part.mesh.geometry.computeBoundingBox();
  const box = part.mesh.geometry.boundingBox;
  const worldBox = new THREE.Box3();
  if (!box) return worldBox.setFromCenterAndSize(part.assembled.position, new THREE.Vector3());
  const matrix = new THREE.Matrix4().compose(part.assembled.position, part.assembled.quaternion, part.assembled.scale);
  const corner = new THREE.Vector3();
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        worldBox.expandByPoint(corner.set(x, y, z).applyMatrix4(matrix));
      }
    }
  }
  return worldBox;
}

// A part's physical center in world space at its assembled pose -- use this everywhere a part's
// "location" matters, never `assembled.position` (the mesh's own, possibly off-center, baked
// pivot). See the section header above for why.
export function assembledGeometricCenter(part: PartRecord): THREE.Vector3 {
  const center = new THREE.Vector3();
  assembledWorldBox(part).getCenter(center);
  return center;
}

// An infinite line through world space: `point` any point on it, `axis` its (unit) direction. Used
// here for the crank centerline -- see EngineScene.ts's load() for how it's derived from the
// crankshaft's own geometry, and computeBoreAxis below for how it defines each bank's bore
// direction.
export interface WorldLine {
  readonly point: THREE.Vector3;
  readonly axis: THREE.Vector3;
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

// The direction a bank's pistons travel (their bore axis), defined relative to the crank
// centerline rather than from any single part's own geometry: bore = normalize((bank's piston
// centroid - crankLine.point), with its component along crankLine.axis removed). Physically, a
// bore is the line a piston travels along, and that line runs from the crankshaft's own axis out
// to the bank -- "which way is out, away from the crank" is exactly "perpendicular component of
// (centroid - crank point)". Every position going into this (the centroid and the crank line
// itself) is a GEOMETRIC center (see assembledGeometricCenter above), never `assembled.position`/
// `exploded.position` (mesh origins).
//
// Two earlier derivations were both tried and both empirically wrong for this GLB:
//   1. Each piston's local "up" (0,1,0) rotated by its own assembled/exploded orientation -- wrong
//      because this rig bakes the bank's ~+-45 degree tilt directly into the vertex data, with
//      every piston mesh itself carrying an identity (or near-identity) rotation, so "local up
//      rotated by the mesh's orientation" resolved to ~world (0,1,0) for every piston in both
//      banks regardless of which way that bank actually tilts. The bore axis silently collapsed
//      to world Y and the "oriented" box read as just another axis-aligned one.
//   2. The normalized mean, per bank, of each piston's own (exploded.position - assembled.position)
//      displacement -- plausible (parts explode along their own assembly axis) but also wrong: the
//      explode step for these pistons pushes them mostly VERTICALLY out of the block, not out along
//      their bore, so displacement is not a reliable proxy for the bore direction either.
// The crank-to-bank direction above is the actual physical definition of a bore and doesn't depend
// on either a mesh's own (unreliable) rotation or how the explode animator happened to stage it.
//
// Since this module is pure of any notion of "the crankshaft" (see the top-of-file comment),
// `crankLine` is computed once in EngineScene.ts's load() (from the crankshaft's own geometry) and
// passed in here.
//
// Sanity expectation (recorded here since no runtime validation is permitted this session): for
// this V8's two banks tilted roughly +-45 degrees about the crank axis, the two banks' bore axes
// should come out as approximate mirror images of each other -- e.g. something like
// normalize(+-0.7, 0.7, ~0) -- not both landing near world (0, 1, 0). Note the exploded pose keeps
// the SAME quaternion as assembled (see EngineScene.ts's load()/explodedPoses comment -- explode
// only translates, never tumbles), so a part's tilt is identical whether read from its assembled or
// exploded pose -- the glass boxes (built from the exploded snapshot in computeMismatchBoxBounds)
// come out correctly oriented for exactly that reason.
export function computeBoreAxis(bank: readonly PartRecord[], crankLine: WorldLine): THREE.Vector3 {
  const centroid = new THREE.Vector3();
  for (const part of bank) centroid.add(assembledGeometricCenter(part));
  centroid.divideScalar(Math.max(bank.length, 1));

  const toCentroid = centroid.sub(crankLine.point);
  const along = toCentroid.dot(crankLine.axis);
  toCentroid.addScaledVector(crankLine.axis, -along); // now just the component perpendicular to the crank axis
  if (toCentroid.lengthSq() > 1e-8) return toCentroid.normalize();

  // Degenerate only if a bank's piston centroid sits almost exactly ON the crank axis, which
  // shouldn't happen for a real V8 bank -- an arbitrary vector orthogonal to the crank axis keeps
  // this from ever returning a zero-length axis.
  const seed = Math.abs(crankLine.axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  return new THREE.Vector3().crossVectors(crankLine.axis, seed).normalize();
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
// (see computeMismatchBoxBounds) -- each part's LOCAL `matrix` is read directly (see the vertex
// loop below for why local, not matrixWorld). There's no running-engine motion to clear room for
// (the box hugs the pistons' static exploded pose exactly) -- see computeMismatchBoxBounds.
function orientedBankBounds(bank: readonly PartRecord[], crankLine: WorldLine): OrientedBoxBounds {
  const bore = computeBoreAxis(bank, crankLine);
  const crank = computeCrankAxis(bank, bore);
  const lateral = new THREE.Vector3().crossVectors(bore, crank).normalize();
  const crankOrtho = new THREE.Vector3().crossVectors(lateral, bore).normalize();

  // Bounds come from each piston's ACTUAL VERTICES (not its local geometry bounding box's 8
  // corners) transformed into world/group space and re-expressed in the (bore, crankOrtho,
  // lateral) frame via dot products. This GLB bakes each bank's ~45 degree tilt directly into
  // vertex data (see the geometry-derived-centers header comment above) -- a piston's own LOCAL
  // bounding box is axis-aligned in a frame that does NOT match the piston's true (tilted) extent,
  // so it's already a fat, diagonally-spanning box substantially larger than the piston itself.
  // Projecting that fat box's 8 corners into the (bore, crankOrtho, lateral) frame measured the fat
  // box, not the piston, which is what produced boxes reading as ~30% too wide. Iterating the real
  // vertex positions instead measures the piston's actual silhouette in the tilted frame, however
  // sparse or dense the mesh's geometry is -- correct regardless of whether it's indexed (indices
  // only dedupe range checks like this, they never invalidate them).
  //
  // Measured with each part's LOCAL `matrix` (parent-relative), not `matrixWorld` -- see
  // axisAlignedBounds's comment above for why (group-local bounds, parented under `group` in
  // EngineScene.ts, group assumed translation-only).
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const vertex = new THREE.Vector3();
  for (const part of bank) {
    const position = part.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(part.mesh.matrix);
      const fx = vertex.dot(bore);
      const fy = vertex.dot(crankOrtho);
      const fz = vertex.dot(lateral);
      min.set(Math.min(min.x, fx), Math.min(min.y, fy), Math.min(min.z, fz));
      max.set(Math.max(max.x, fx), Math.max(max.y, fy), Math.max(max.z, fz));
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

  // Same sliver-of-padding rationale as the ring container below -- tight, not loose. Sized purely
  // to the pistons' own padded exploded-pose geometry along each axis of the (bore, crankOrtho,
  // lateral) frame -- no extra bore-axis headroom, since nothing inside this box moves anymore.
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
// Assumes the caller has already snapped these meshes to their exploded pose. Padded by
// RING_BOX_PADDING on two axes (not the bank boxes' snugger BOUNDING_BOX_PADDING) -- see that
// constant's comment for why the ring box needs the extra headroom -- and by the larger
// RING_BOX_AXIAL_PADDING on the crank axis specifically (see that constant's comment): the ring
// was still clipping the gear at the front along the crank axis even with uniform 1.08, since that
// one direction (the gear's face-on extent) needed more slack than the other two. `crankAxis` is
// the SAME crankLine.axis already threaded through to computeBoreAxis for the bank boxes (see
// computeMismatchBoxBounds) -- which world component (x/y/z) is "the crank axis" is derived from
// its dominant component here rather than hardcoded, so this keeps working if the rig's axis
// convention ever changes; for this rig it's ~Z (see EngineScene.ts's deriveCrankLine).
//
// Measured with each part's LOCAL `matrix` (parent-relative), not `matrixWorld` -- the returned
// bounds are consumed by buildGlassBoxGroup and parented under the engine `group` itself (see
// EngineScene.ts's load()), not under `scene`, so they need to be expressed in that same
// group-local space to line up. This assumes `group` only ever translates (see EngineScene.ts's
// applyFrame, which sets group.position from recenterOffset + ambient drift and never touches its
// rotation/scale) -- if the group ever gained a rotation, local and world frames would no longer
// share the same orientation and this box-fitting would need to account for it. Since parts are
// direct children of `group`, `part.mesh.matrix` already IS parent(group)-relative -- no manual
// world-to-group conversion needed.
function axisAlignedBounds(parts: readonly PartRecord[], crankAxis: THREE.Vector3): OrientedBoxBounds {
  const bounds = new THREE.Box3();
  const partBounds = new THREE.Box3();
  for (const part of parts) {
    part.mesh.geometry.computeBoundingBox();
    partBounds.copy(part.mesh.geometry.boundingBox!).applyMatrix4(part.mesh.matrix);
    bounds.union(partBounds);
  }
  const size = new THREE.Vector3();
  bounds.getSize(size).multiplyScalar(RING_BOX_PADDING);
  // Re-pad whichever world axis (x/y/z) crankAxis is dominantly aligned with, up to the larger
  // RING_BOX_AXIAL_PADDING -- multiplying by the ratio (not re-deriving from the unpadded size)
  // keeps this a pure extra factor on top of the uniform pass above, regardless of order.
  const axialRatio = RING_BOX_AXIAL_PADDING / RING_BOX_PADDING;
  const ax = Math.abs(crankAxis.x);
  const ay = Math.abs(crankAxis.y);
  const az = Math.abs(crankAxis.z);
  if (ax >= ay && ax >= az) size.x *= axialRatio;
  else if (ay >= ax && ay >= az) size.y *= axialRatio;
  else size.z *= axialRatio;
  const center = new THREE.Vector3();
  bounds.getCenter(center);
  return { center, size, quaternion: new THREE.Quaternion() };
}

// Per-piston bore axes for the t68-72 "parallel adjust" beat (beats.ts's partAdjustAt):
// EngineScene.ts offsets each piston outward along its own bank's bore axis while the ring gear
// regrows. Reuses the same bank split (splitPistonBanks) and bore-axis derivation
// (computeBoreAxis) the glass boxes already use, so the adjust direction is guaranteed to agree
// with "away from the crank line" exactly the way the boxes are oriented -- one definition of
// "outward" for this rig, not two independently-derived ones. Returns a Map keyed by PartRecord
// (not mesh.uuid) since EngineScene already indexes its own per-part state that way.
export function computePistonBoreAxes(
  pistons: readonly PartRecord[],
  crankLine: WorldLine
): Map<PartRecord, THREE.Vector3> {
  const [leftBank, rightBank] = splitPistonBanks(pistons);
  const axes = new Map<PartRecord, THREE.Vector3>();
  const leftBore = computeBoreAxis(leftBank, crankLine);
  const rightBore = computeBoreAxis(rightBank, crankLine);
  for (const part of leftBank) axes.set(part, leftBore);
  for (const part of rightBank) axes.set(part, rightBore);
  return axes;
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
// `crankLine` is the crank centerline computed once in EngineScene.ts's load() (from the
// crankshaft's own geometry) -- threaded through to computeBoreAxis via orientedBankBounds (see
// its comment for the full derivation), and its axis alone is also passed to axisAlignedBounds so
// the ring container can single out its crank-axis dimension for RING_BOX_AXIAL_PADDING.
export function computeMismatchBoxBounds(
  parts: MismatchBoxParts,
  group: THREE.Group,
  crankLine: WorldLine
): MismatchBoxBounds {
  const [leftBank, rightBank] = splitPistonBanks(parts.pistons);
  const allParts = [...parts.ring, ...parts.pistons];

  for (const part of allParts) {
    part.mesh.position.copy(part.exploded.position);
    part.mesh.quaternion.copy(part.exploded.quaternion);
    part.mesh.scale.copy(part.exploded.scale);
  }
  group.updateMatrixWorld(true);

  const ring = axisAlignedBounds(parts.ring, crankLine.axis);
  const leftBankBounds = orientedBankBounds(leftBank, crankLine);
  const rightBankBounds = orientedBankBounds(rightBank, crankLine);

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
