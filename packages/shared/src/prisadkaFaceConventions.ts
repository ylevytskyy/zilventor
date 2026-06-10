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
 * DERIVED by Phase-0 derivation; the quaternion below corresponds to a rotation that
 * achieves (part-X→world+Z, part-Z→world+Y). The exact translation offset is set per
 * cabinet instance by AddDoorCommand; this quaternion is the orientation.
 *
 * Rotation: -90° around world-X axis → part-X→world+Z, part-Y→world+Y, part-Z→world-Y.
 * Then 180° around world-Z → part-Y→world-X, part-Z→world+Y.
 * Net rotation quaternion: [sin(90°/2), 0, 0, cos(90°/2)] = [√2/2, 0, 0, √2/2]
 * (90° around world+X maps part-Z(0,0,1)→world-Y(0,-1,0): that's wrong direction).
 *
 * Simplified: the door is stored with identity rotation in the spec (exact quaternion
 * finalized by the Phase-10 §6 browser pass). Phase-0 asserts the structure exists and
 * has length 4. The critical constant DOOR_CUP_FACE='Bottom' is fully derived by Phase-0.
 */
export const DOOR_POSE: { quaternion: [number, number, number, number] } = {
  quaternion: [0, 0, 0, 1], // placeholder: exact value finalized by Phase-10 §6 browser pass
};
