import type { PanelFaceRole } from './bore';

export type BroadFace = Extract<PanelFaceRole, 'Top' | 'Bottom'>;

/**
 * Which broad (H×D) face of each SIDE panel points into the cabinet interior, in the
 * panel's NATIVE part frame (unswapped: {length:H, width:D, thickness:Tc}).
 *
 * DERIVED + PROVEN by the Phase-0 derivation test (HoleFeature.phase0-contract.integration.spec.ts).
 * The test computes each value from the known render rotation (GenerateCarcassBoresCommand L↔T
 * swap: part-Z/thickness → world-X) and asserts these exported constants match. Do NOT trust
 * the literal blindly — the Phase-0 test goes RED if this value is wrong.
 *
 * Geometry:
 *   leftSide render rotation: part-Z (+Z = Top) → world+X (toward cabinet center at x=W/2).
 *   TOP outward normal (+Z) maps to world +X → points toward interior → LEFT_SIDE_INNER_FACE = 'Top'.
 *   rightSide render rotation: part-Z (+Z = Top) → world+X (toward EXTERIOR, away from center).
 *   BOTTOM outward normal (-Z) maps to world -X → points toward interior → RIGHT_SIDE_INNER_FACE = 'Bottom'.
 *   Mirror: LEFT and RIGHT are always opposite.
 */
export const LEFT_SIDE_INNER_FACE: BroadFace = 'Top';
export const RIGHT_SIDE_INNER_FACE: BroadFace = 'Bottom';

/**
 * The DOOR's broad face that points toward the carcass (where the Ø35 cup is bored).
 *
 * DERIVED + PROVEN by the Phase-0 derivation test. The door part
 * {length=doorH, width=doorW, thickness=Td} is stood upright at the cabinet front with
 * part-Z (Td) → world-Y (depth). Bottom (z=0) faces the carcass; Top (z=Td) faces the room.
 * Therefore DOOR_CUP_FACE = 'Bottom'.
 */
export const DOOR_CUP_FACE: BroadFace = 'Bottom';

/**
 * The door component's upright pose at the cabinet front.
 * Part-X (doorH/height) → world-Z (up), part-Y (doorW/width) → world-X (across),
 * part-Z (Td/thickness) → world-Y (out the front, toward the room).
 *
 * DERIVED by Phase-10 §6 browser pass (Shepperd's method on the rotation matrix whose
 * columns are the world-frame images of each part basis vector):
 *   R = [[0,1,0],[0,0,1],[1,0,0]]  (row-major, R[i][j] = row i col j)
 *   col 0 (part+X → world): (0,0,1) = world+Z  (door height stands vertical)
 *   col 1 (part+Y → world): (1,0,0) = world+X  (door width runs horizontal)
 *   col 2 (part+Z → world): (0,1,0) = world+Y  (door thickness goes toward room)
 *
 * Shepperd branch (all diagonals 0, pick R[0][0]):
 *   x = sqrt(1 + R[0][0] - R[1][1] - R[2][2]) / 2 = 0.5
 *   y = (R[0][1] + R[1][0]) / (4x) = (1+0)/2 = 0.5
 *   z = (R[0][2] + R[2][0]) / (4x) = (0+1)/2 = 0.5
 *   w = (R[2][1] - R[1][2]) / (4x) = (0-1)/2 = -0.5
 *
 * DOOR_CUP_FACE='Bottom' is correct: Bottom face outward normal = part-Z's (-Z direction)
 * maps to world -Y (toward cabinet interior). Phase-10 §6 gate verified world-Z extent ≈ doorH.
 */
export const DOOR_POSE: { quaternion: [number, number, number, number] } = {
  quaternion: [0.5, 0.5, 0.5, -0.5], // FINALIZED by Phase-10 §6 browser pass
};
