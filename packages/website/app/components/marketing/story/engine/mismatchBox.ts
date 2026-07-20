// The mismatch bounding-box prop: a translucent green box that fades in around just the mismatch
// story's own parts while every highlight is dark, and fades back out as those parts resolve to
// the shared green. Pure besides the `three` types it operates on -- holds no mutable module
// state; the box's THREE.Group instance itself lives in EngineScene.
import * as THREE from 'three';
import { HIGHLIGHT_GREEN } from './beats';
import type { PartRecord } from './types';

// --- Mismatch bounding box -----------------------------------------------------------------
// A translucent green box that fades in around just the mismatch story's own parts (gear,
// pistons, engineBackCover -- not the whole engine) while every highlight is dark
// (frame.boxWeight, ~t46-60 peaking at 60), and fades back out as those parts resolve to the
// shared green (~t60-72). A fixed prop: sized/positioned once at load time from those parts'
// exploded pose (see computeMismatchBoxBounds) rather than tracked live, since explode is held
// flat for this entire window -- nothing it encloses moves.
export const BOUNDING_BOX_MAX_OPACITY = 0.16;
export const BOUNDING_BOX_EDGE_OPACITY = 0.85;

// The box only encloses the mismatch story's own parts (gear, pistons, engineBackCover), not
// the whole engine -- a box around every part read as far too large, swallowing parts that
// never take part in this beat at all. Computed once, statically, from those parts' *exploded*
// pose (position/quaternion/scale, no live mesh state needed) since explode is held flat at 1
// for this entire window (see beats.ts's explodeAt) -- nothing it encloses moves. Temporarily
// snaps the relevant meshes to their exploded pose to read a world-space Box3 via expandByObject,
// then restores them to their construction-time assembled pose (the real pose gets applied by the
// first setFrame call regardless, but leaving stale exploded-pose meshes around in the meantime
// risks a mismatched flash before that first frame lands).
export function computeMismatchBoxBounds(relevantParts: PartRecord[], group: THREE.Group): THREE.Box3 {
  for (const part of relevantParts) {
    part.mesh.position.copy(part.exploded.position);
    part.mesh.quaternion.copy(part.exploded.quaternion);
    part.mesh.scale.copy(part.exploded.scale);
  }
  group.updateMatrixWorld(true);
  // Bounds come from each part's own geometry + matrixWorld, computed directly rather than via
  // Box3.expandByObject(part.mesh) -- expandByObject also traverses children, which (before
  // highlights moved onto the parts' own materials) used to include oversized highlight overlay
  // meshes and inflate this box well past the parts' real silhouette.
  const bounds = new THREE.Box3();
  const partBounds = new THREE.Box3();
  for (const part of relevantParts) {
    part.mesh.geometry.computeBoundingBox();
    partBounds.copy(part.mesh.geometry.boundingBox!).applyMatrix4(part.mesh.matrixWorld);
    bounds.union(partBounds);
  }

  for (const part of relevantParts) {
    part.mesh.position.copy(part.assembled.position);
    part.mesh.quaternion.copy(part.assembled.quaternion);
    part.mesh.scale.copy(part.assembled.scale);
  }
  group.updateMatrixWorld(true);

  return bounds;
}

// A plain unit cube scaled/positioned once to `bounds` (see computeMismatchBoxBounds) --
// translucent and unlit, standing in for "something is being measured/flagged" while every
// enclosed part's own highlight shell is dark (~t46-60). Static: only its opacity/visibility
// change per frame (see updateBoundingBox), since the parts it encloses don't move during the
// window it's shown in.
//
// A flat translucent fill alone reads as a uniform-color smear -- MeshBasicMaterial doesn't
// shade differently by face orientation, so there's no depth cue telling the eye where the box's
// faces/edges actually are. An EdgesGeometry outline drawn on top of the fill gives it crisp,
// legible corners so it reads as a bounded volume rather than a blob. The group's first child is
// always the fill mesh, the second the edge outline -- see updateBoundingBox.
export function buildBoundingBox(bounds: THREE.Box3): THREE.Group {
  const size = new THREE.Vector3();
  bounds.getSize(size);
  const center = new THREE.Vector3();
  bounds.getCenter(center);

  // A touch of padding so the box comfortably encloses the parts rather than hugging their
  // exact silhouette.
  const geometry = new THREE.BoxGeometry(
    Math.max(size.x, 1e-3) * 1.08,
    Math.max(size.y, 1e-3) * 1.08,
    Math.max(size.z, 1e-3) * 1.08
  );
  const material = new THREE.MeshBasicMaterial({
    color: HIGHLIGHT_GREEN,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false // unlit story UI, not part of the physical scene -- must not veil with depth
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
  group.position.copy(center);
  group.visible = false;
  return group;
}

// The box is a fixed prop (see computeMismatchBoxBounds/buildBoundingBox) -- only its
// opacity/visibility respond to the frame. Deliberately untouched by pulseWeight/pulseWave --
// the mismatch box is a steady static prop, not one of the pulsing highlights.
export function updateBoundingBox(box: THREE.Group | null, boxWeight: number): void {
  if (!box) return;
  const [fill, edges] = box.children as [THREE.Mesh, THREE.LineSegments];
  const fillMaterial = fill.material as THREE.MeshBasicMaterial;
  const edgesMaterial = edges.material as THREE.LineBasicMaterial;
  fillMaterial.opacity = boxWeight * BOUNDING_BOX_MAX_OPACITY;
  // The outline reads clearly at a much lower opacity than the fill needs for its wash -- pushed
  // well above the fill's own weight so the box's edges stay crisp even while the fill is faint.
  edgesMaterial.opacity = boxWeight * BOUNDING_BOX_EDGE_OPACITY;
  box.visible = boxWeight >= 0.01;
}
