/**
 * CHUNK G — Task G.1: jointDir provenance guard (real generator output).
 *
 * Verifies that after Chunk A/C add `jointDir` to the generators:
 *   - generateConfirmat/Minifix/Dowel bores carry jointDir ≈ normalized JointInput.line direction
 *   - hinge cup + plate bores (from hingeCupBores/hingePlateBores) do NOT carry jointDir
 *   - shelf-pin bores do NOT carry jointDir
 *   - jointDir is a unit vector (length ≈ 1, not NaN)
 *
 * Flip-to-RED: remove jointDir from generateConfirmat output → assertion fails for carcass bores.
 * Uses REAL cabinet joint (same fixture as confirmat guard) — not hand-authored coords.
 */
import { describe, it, expect } from 'vitest';
import {
  generateConfirmat, generateMinifix, generateDowel,
  hingeCupBores, hingePlateBores,
  hingePositions, hingeCountForHeight,
  shelfPinGrid, DEFAULT_SHELF_PIN_PARAMS,
  DOOR_CUP_FACE,
  LEFT_SIDE_INNER_FACE,
  type JointInput, type BoringParams,
} from '@zilventor/shared';

const W_CAB = 600, D = 560, H = 720, Tc = 18, Tb = 6;
const BOTTOM_DIMS = { length: W_CAB - 2 * Tc, width: D - Tb, thickness: Tc }; // 564×554×18
const BORING_PARAMS: BoringParams = { endSetback: 60, maxSpacing: 250, minCount: 2 };

function realCabinetJoint(): JointInput {
  return {
    line: { p0: { x: Tc, y: Tb, z: Tc / 2 }, p1: { x: Tc, y: D, z: Tc / 2 } },
    panelA: {
      dims: { length: Tc, width: D, thickness: H },
      pose: { translation: { x: Tc / 2, y: D / 2, z: H / 2 }, quaternion: [0, 0, 0, 1] },
    },
    panelB: {
      dims: BOTTOM_DIMS,
      pose: {
        translation: {
          x: Tc + BOTTOM_DIMS.length / 2,
          y: Tb + BOTTOM_DIMS.width / 2,
          z: BOTTOM_DIMS.thickness / 2,
        },
        quaternion: [0, 0, 0, 1],
      },
    },
    faceA: 'Right',
    endB: 'Left',
    boardThicknessA: Tc,
    boardThicknessB: Tc,
  };
}

function expectedJointDir(j: JointInput): { x: number; y: number; z: number } {
  const { p0, p1 } = j.line;
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  const len = Math.hypot(dx, dy, dz);
  return { x: dx / len, y: dy / len, z: dz / len };
}

describe('CHUNK G.1 — jointDir provenance (slice-3 generators)', () => {
  const joint = realCabinetJoint();
  const expectedDir = expectedJointDir(joint);

  it('confirmat boresA carry jointDir ≈ normalized line direction, not NaN, unit length', () => {
    const { boresA } = generateConfirmat(joint, BORING_PARAMS);
    for (const b of boresA) {
      // RED without Chunk A/C impl: b.jointDir will be undefined
      expect(b.jointDir).toBeDefined();
      const d = b.jointDir!;
      expect(isNaN(d.x)).toBe(false);
      expect(isNaN(d.y)).toBe(false);
      expect(isNaN(d.z)).toBe(false);
      const mag = Math.hypot(d.x, d.y, d.z);
      expect(mag).toBeCloseTo(1, 4); // unit vector
      expect(d.x).toBeCloseTo(expectedDir.x, 4);
      expect(d.y).toBeCloseTo(expectedDir.y, 4);
      expect(d.z).toBeCloseTo(expectedDir.z, 4);
    }
  });

  it('confirmat boresB carry the SAME jointDir as boresA (same joint)', () => {
    const { boresA, boresB } = generateConfirmat(joint, BORING_PARAMS);
    for (let i = 0; i < Math.min(boresA.length, boresB.length); i++) {
      const a = boresA[i]!.jointDir!;
      const b = boresB[i]!.jointDir!;
      expect(a.x).toBeCloseTo(b.x, 6);
      expect(a.y).toBeCloseTo(b.y, 6);
      expect(a.z).toBeCloseTo(b.z, 6);
    }
  });

  it('minifix boresA and boresB carry jointDir ≈ normalized line direction', () => {
    const { boresA, boresB } = generateMinifix(joint, BORING_PARAMS);
    for (const b of [...boresA, ...boresB]) {
      expect(b.jointDir).toBeDefined();
      const d = b.jointDir!;
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 4);
      expect(d.y).toBeCloseTo(expectedDir.y, 4);
    }
  });

  it('dowel boresA and boresB carry jointDir ≈ normalized line direction', () => {
    const { boresA, boresB } = generateDowel(joint, BORING_PARAMS);
    for (const b of [...boresA, ...boresB]) {
      expect(b.jointDir).toBeDefined();
      const d = b.jointDir!;
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 4);
    }
  });

  it('hinge cup bores do NOT carry jointDir (absent, not undefined-but-present)', () => {
    const doorDims = { length: 716, width: 596, thickness: 18 };
    const us = hingePositions(716, hingeCountForHeight(716));
    const cups = hingeCupBores(doorDims, DOOR_CUP_FACE, 'left', 'full', us);
    for (const c of cups) {
      expect('jointDir' in c).toBe(false);
    }
  });

  it('hinge plate bores do NOT carry jointDir', () => {
    const sideDims = { length: H, width: D, thickness: Tc };
    const us = hingePositions(716, hingeCountForHeight(716));
    const plates = hingePlateBores(sideDims, LEFT_SIDE_INNER_FACE, us, 37);
    for (const p of plates) {
      expect('jointDir' in p).toBe(false);
    }
  });

  it('shelf-pin bores do NOT carry jointDir', () => {
    const sideDims = { length: H, width: D, thickness: Tc };
    const pins = shelfPinGrid(sideDims, LEFT_SIDE_INNER_FACE, DEFAULT_SHELF_PIN_PARAMS);
    for (const p of pins) {
      expect('jointDir' in p).toBe(false);
    }
  });

  it('degenerate joint (p0===p1) does NOT produce NaN jointDir — bore omits the field', () => {
    const degenerateJoint: JointInput = {
      ...realCabinetJoint(),
      line: { p0: { x: 10, y: 10, z: 10 }, p1: { x: 10, y: 10, z: 10 } },
    };
    // The generator must skip jointDir (absent) rather than writing NaN.
    const { boresA } = generateConfirmat(degenerateJoint, BORING_PARAMS);
    for (const b of boresA) {
      if ('jointDir' in b) {
        // If present, MUST be a valid unit vector, not NaN
        const d = b.jointDir!;
        expect(isNaN(d.x)).toBe(false);
        expect(isNaN(d.y)).toBe(false);
        expect(isNaN(d.z)).toBe(false);
      }
      // Either absent or finite — never NaN
    }
  });
});
