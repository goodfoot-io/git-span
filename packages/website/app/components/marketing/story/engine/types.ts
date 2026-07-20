// Shared plain-data shapes for the baked engine rig -- split out so highlights.ts and
// mismatchBox.ts can depend on them without importing EngineScene.ts itself.
import type * as THREE from 'three';
import type { PartFamily } from './parts';

export interface Pose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

export interface PartRecord {
  mesh: THREE.Mesh;
  assembled: Pose;
  exploded: Pose;
  family: PartFamily;
  isFrontDrive: boolean;
  isMount: boolean;
  // FRONT_DRIVE_SEAT_ADJUST subset -- only `gear` is physically adjacent to FRONT_MOUNT, so only
  // it remaps its seat target onto the resized mount in `updatePartTransforms`; see parts.ts.
  isSeatAdjust: boolean;
  // ORANGE_EMPHASIS subset -- the pistons get the same pre-highlight orange pulse as FRONT_DRIVE
  // (gear) without joining that list (no resize/lift/green/red). See parts.ts.
  isOrangeEmphasis: boolean;
  localSphere: THREE.Sphere; // geometry-local, unscaled -- transformed by matrixWorld per frame
}
