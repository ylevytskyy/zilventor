/**
 * Handle/pull pose math for присадка slice 6.
 *
 * Pure function — no SKU catalog, no DOOR_POSE import.
 * Returns the pull component's pose in CABINET-WORLD frame.
 *
 * Coordinate conventions (confirmed via drawerFrontMath.ts):
 *   world-X = horizontal (width/opening direction)
 *   world-Y = depth axis; LARGER y = toward room (front face outward)
 *   world-Z = vertical
 *
 * Front center is at frontTranslation.y = dims.depth (per drawerFrontMath line 97).
 * Outward face of front = frontTranslation.y + frontThickness/2 (toward room).
 * Pull box is centered-baked (authored symmetric about origin), so offset by bbox.w/2
 * to sit PROUD of (outside) the outward face.
 *
 * Identity quaternion [x,y,z,w] = [0,0,0,1] — pull is authored in cabinet-world frame,
 * NOT in DOOR_POSE frame.
 */

import type { Vec3 } from './types';

export interface HandlePullBbox {
  /** Bar length (maps to world-X / horizontal). */
  l: number;
  /** Standoff / proud depth (maps to world-Y). */
  w: number;
  /** Bar height (maps to world-Z / vertical). */
  h: number;
}

export interface HandlePullPoseInput {
  /** World-frame translation of the front component's center. */
  frontTranslation: Vec3;
  /** Front panel thickness in mm. */
  frontThickness: number;
  /** Pull bounding-box dimensions (l, w, h) in mm. */
  bbox: HandlePullBbox;
}

export interface HandlePullPoseResult {
  translation: Vec3;
  /** Identity quaternion in [x, y, z, w] order = [0, 0, 0, 1]. */
  quaternion: [number, number, number, number];
}

/**
 * Compute the pull component's pose in cabinet-world coordinates.
 *
 * @param input - front component center, thickness, and pull bbox dimensions.
 * @returns translation (proud of front outward face) + identity quaternion.
 */
export function handlePullPose(input: HandlePullPoseInput): HandlePullPoseResult {
  const { frontTranslation, frontThickness, bbox } = input;

  // Outward face of front panel (toward room = larger world-Y)
  const outwardFaceY = frontTranslation.y + frontThickness / 2;

  // Pull center sits bbox.w/2 proud of that face
  const pullY = outwardFaceY + bbox.w / 2;

  return {
    translation: {
      x: frontTranslation.x,
      y: pullY,
      z: frontTranslation.z,
    },
    // Identity: pull is authored in cabinet-world frame, no rotation needed.
    // [x, y, z, w] order to match types.ts ComponentInstance.pose.quaternion.
    quaternion: [0, 0, 0, 1],
  };
}
