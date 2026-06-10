import { describe, it, expect } from 'vitest';
import {
  generateConfirmat, generateMinifix, generateDowel,
  type JointInput, type BoringParams,
} from '../connectorCatalog';

const defaults: BoringParams = { endSetback: 60, maxSpacing: 250, minCount: 2 };

// A 700mm joint along +X at the shared edge. A = face-drilled side panel,
// B = end-drilled bottom panel. Dims/poses are illustrative (generators are
// pure over jointLen + faceA/endB; pose feeds frame placement downstream).
function joint(len = 700): JointInput {
  return {
    line: { p0: { x: 0, y: 0, z: 0 }, p1: { x: len, y: 0, z: 0 } },
    panelA: { dims: { length: 800, width: 500, thickness: 18 },
      pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
    panelB: { dims: { length: len, width: 500, thickness: 18 },
      pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
    faceA: 'Left',
    endB: 'Top',
    boardThicknessA: 18,
    boardThicknessB: 18,
  };
}

/**
 * BLOCKER GUARD: real cabinet dims after L↔T swap for side panels.
 *
 * GenerateCarcassBoresCommand swaps length↔thickness for leftSide/rightSide panels so
 * jointMath computes the correct world AABB. After the swap the joint fed to the catalog has:
 *   panelA = side panel with effective dims {length:18, width:560, thickness:720}
 *            (real board thickness = 18, but dims.thickness = 720 after swap)
 *   panelB = bottom panel with real dims {length:564, width:554, thickness:18}
 *   faceA  = 'Right'  (side panel's inner face)
 *   endB   = 'Left'   (bottom panel's left end, the one that butts the side)
 *
 * face2DFrame('Left', {L:564, W:554, T:18}):
 *   origin={-282,-277,0}, uDir={0,0,1}(+Z = thickness axis of bottom), vDir={0,1,0}(+Y)
 *   → u must be in [0,18] (thickness-centerline of bottom = 9)
 *   → v must be the along-joint spacing (in Y: 60, 277, 494 for 554mm joint)
 *
 * Before the fix:
 *   B1: depth = 50 - panelA.dims.thickness = 50 - 720 = -670  (NEGATIVE → BLOCKER)
 *   B2: v = panelA.dims.thickness / 2 = 360  (out of bounds, Y∈[0,554])
 *       u = spacing (60,277,494)            (wrong: u must be ≤18 for Left face)
 */
function swappedSideBottomJoint(): JointInput {
  // 554mm joint (left↔bottom, same 600×560×720 cabinet fixture as the command spec).
  // endSetback=60, maxSpacing=250 → count=3, spacings=[60, 277, 494].
  const jointLen = 554;
  return {
    line: { p0: { x: 18, y: 6, z: 9 }, p1: { x: 18, y: 560, z: 9 } },
    panelA: {
      // Side panel AFTER L↔T swap: dims.thickness = 720 (WRONG for board thickness).
      dims: { length: 18, width: 560, thickness: 720 },
      pose: { translation: { x: 9, y: 280, z: 360 }, quaternion: [0, 0, 0, 1] },
    },
    panelB: {
      // Bottom panel: real dims, no swap.
      dims: { length: 564, width: 554, thickness: 18 },
      pose: { translation: { x: 300, y: 280, z: 9 }, quaternion: [0, 0, 0, 1] },
    },
    faceA: 'Right',
    endB: 'Left',
    // Real board thickness — not read from dims.thickness after swap.
    boardThicknessA: 18,
    boardThicknessB: 18,
  };
}

describe('BLOCKER B1+B2 — swapped side-panel dims must not corrupt depth/u/v', () => {
  it('B1: confirmat-edge depth must be positive (50 - boardThicknessA = 32, not 50-720=-670)', () => {
    const r = generateConfirmat(swappedSideBottomJoint(), defaults);
    for (const b of r.boresB) {
      expect(typeof b.depth).toBe('number');
      expect(b.depth as number).toBeGreaterThan(0);
      expect(b.depth as number).toBeCloseTo(32, 1); // 50 - 18 = 32
    }
  });

  it('B2: confirmat-edge u must be ≤18 (thickness-centerline ≈9, not spacing 60/277/494)', () => {
    const r = generateConfirmat(swappedSideBottomJoint(), defaults);
    // face2DFrame('Left'): uDir=+Z → u must be within [0, T_bottom=18]
    for (const b of r.boresB) {
      expect(b.u).toBeGreaterThanOrEqual(0);
      expect(b.u).toBeLessThanOrEqual(18);
      expect(b.u).toBeCloseTo(9, 1); // boardThicknessB / 2 = 9
    }
  });

  it('B2: confirmat-edge v must be the along-joint spacing (60/277/494), not 360', () => {
    const r = generateConfirmat(swappedSideBottomJoint(), defaults);
    const expectedSpacings = [60, 277, 494];
    const vs = r.boresB.map((b) => b.v).sort((a, b) => a - b);
    expect(vs).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(vs[i]).toBeCloseTo(expectedSpacings[i]!, 1);
    }
  });

  it('B2: v must be one of the spacing values (60/277/494), NOT the corrupt 360', () => {
    const r = generateConfirmat(swappedSideBottomJoint(), defaults);
    const expectedSpacings = [60, 277, 494];
    for (const b of r.boresB) {
      expect(b.v).toBeLessThan(560); // within the joint length
      // v must be one of the spacing distances — 360 is NOT a valid spacing and must not appear
      const matchesSpacing = expectedSpacings.some((s) => Math.abs(b.v - s) < 1);
      expect(matchesSpacing).toBe(true);
    }
  });
});

describe('count/spacing math (via confirmat)', () => {
  it('700mm joint, defaults → ceil((700-120)/250)+1 = 4 confirmats per side', () => {
    const r = generateConfirmat(joint(700), defaults);
    expect(r.boresA).toHaveLength(4);
    expect(r.boresB).toHaveLength(4);
  });

  it('short joint clamps to minCount=2', () => {
    const r = generateConfirmat(joint(120), defaults);
    expect(r.boresA).toHaveLength(2);
  });

  it('bores are evenly distributed between the setbacks (first at +endSetback, last at len-endSetback)', () => {
    const r = generateConfirmat(joint(700), defaults);
    // confirmat A is the THROUGH (face) panel — its along-joint coordinate is u.
    const us = r.boresA.map((b) => b.u).sort((a, b) => a - b);
    expect(us[0]).toBeCloseTo(60, 3);
    expect(us[us.length - 1]).toBeCloseTo(640, 3);
    // even spacing
    const gaps = us.slice(1).map((u, i) => u - us[i]!);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0]!, 3);
  });
});

describe('generateConfirmat', () => {
  it('A bores Ø7 (through) role confirmat-face; B bores Ø5 role confirmat-edge', () => {
    const r = generateConfirmat(joint(700), defaults);
    for (const b of r.boresA) {
      expect(b.diameter).toBe(7);
      expect(b.role).toBe('confirmat-face');
      expect(b.depth).toBe('throughAll');
      expect(b.connectorKind).toBe('confirmat');
    }
    for (const b of r.boresB) {
      expect(b.diameter).toBe(5);
      expect(b.role).toBe('confirmat-edge');
      expect(b.connectorKind).toBe('confirmat');
    }
  });

  it('each A bore is paired with exactly one B bore by connectorId', () => {
    const r = generateConfirmat(joint(700), defaults);
    const idsA = r.boresA.map((b) => b.connectorId);
    const idsB = r.boresB.map((b) => b.connectorId);
    expect(new Set(idsA)).toEqual(new Set(idsB));
    expect(idsA).toHaveLength(new Set(idsA).size); // unique
  });
});

describe('generateMinifix', () => {
  it('A side gets cam (Ø15) + cross (Ø8) per connector; B side gets bolt (Ø8)', () => {
    const r = generateMinifix(joint(700), defaults);
    const cams = r.boresA.filter((b) => b.role === 'minifix-cam');
    const cross = r.boresA.filter((b) => b.role === 'minifix-cross');
    const bolts = r.boresB.filter((b) => b.role === 'minifix-bolt');
    expect(cams).toHaveLength(4);
    expect(cross).toHaveLength(4);
    expect(bolts).toHaveLength(4);
    for (const c of cams) expect(c.diameter).toBe(15);
    for (const c of cross) expect(c.diameter).toBe(8);
    for (const b of bolts) expect(b.diameter).toBe(8);
  });

  it('minifix-cam depth must be positive and ≤ boardThicknessA (blind cam housing)', () => {
    const r = generateMinifix(swappedSideBottomJoint(), defaults);
    const cams = r.boresA.filter((b) => b.role === 'minifix-cam');
    expect(cams.length).toBeGreaterThan(0);
    for (const c of cams) {
      expect(typeof c.depth).toBe('number');
      expect(c.depth as number).toBeGreaterThan(0);
      // cam housing must not exceed the board thickness (blind bore)
      expect(c.depth as number).toBeLessThanOrEqual(18); // boardThicknessA = 18
    }
  });

  it('minifix-cross depth must be positive and ≤ boardThicknessA (cross bore fits in panel)', () => {
    const r = generateMinifix(swappedSideBottomJoint(), defaults);
    const cross = r.boresA.filter((b) => b.role === 'minifix-cross');
    expect(cross.length).toBeGreaterThan(0);
    for (const c of cross) {
      expect(typeof c.depth).toBe('number');
      expect(c.depth as number).toBeGreaterThan(0);
      // cross bore must fit inside the panel face (depth ≤ boardThicknessA)
      expect(c.depth as number).toBeLessThanOrEqual(18); // boardThicknessA = 18
    }
  });

  it('minifix-bolt depth must be positive and ≤ boardThicknessB', () => {
    const r = generateMinifix(swappedSideBottomJoint(), defaults);
    const bolts = r.boresB.filter((b) => b.role === 'minifix-bolt');
    expect(bolts.length).toBeGreaterThan(0);
    for (const b of bolts) {
      expect(typeof b.depth).toBe('number');
      expect(b.depth as number).toBeGreaterThan(0);
      expect(b.depth as number).toBeLessThanOrEqual(18); // boardThicknessB = 18
    }
  });

  it('minifix-bolt u must be thickness-centerline ≈9 (Left face, u in [0,18])', () => {
    const r = generateMinifix(swappedSideBottomJoint(), defaults);
    const bolts = r.boresB.filter((b) => b.role === 'minifix-bolt');
    for (const b of bolts) {
      expect(b.u).toBeGreaterThanOrEqual(0);
      expect(b.u).toBeLessThanOrEqual(18);
      expect(b.u).toBeCloseTo(9, 1); // boardThicknessB / 2 = 9
    }
  });

  it('minifix-bolt v must be the along-joint spacing (60/277/494), same as confirmat', () => {
    const r = generateMinifix(swappedSideBottomJoint(), defaults);
    const bolts = r.boresB.filter((b) => b.role === 'minifix-bolt');
    const expectedSpacings = [60, 277, 494];
    const vs = bolts.map((b) => b.v).sort((a, b) => a - b);
    expect(vs).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(vs[i]).toBeCloseTo(expectedSpacings[i]!, 1);
    }
  });
});

describe('generateDowel', () => {
  it('A Ø8 face depth=12; B Ø8 end depth=min(13,tB-1)=13 (standard 25mm pin; 18mm board); roles dowel-face/dowel-edge', () => {
    const r = generateDowel(joint(700), defaults); // boardThicknessB=18 → endDepth = min(13,17) = 13
    for (const b of r.boresA) {
      expect(b.diameter).toBe(8);
      expect(b.depth).toBe(12);
      expect(b.role).toBe('dowel-face');
    }
    for (const b of r.boresB) {
      expect(b.diameter).toBe(8);
      expect(b.depth).toBe(13); // min(DOWEL_END_NOMINAL=13, 18-1=17) = 13
      expect(b.role).toBe('dowel-edge');
    }
  });

  it('dowel-face depth > 0 and ≤ boardThicknessA (blind bore in face panel)', () => {
    const r = generateDowel(swappedSideBottomJoint(), defaults);
    for (const b of r.boresA) {
      expect(typeof b.depth).toBe('number');
      expect(b.depth as number).toBeGreaterThan(0);
      expect(b.depth as number).toBeLessThanOrEqual(18); // boardThicknessA = 18
    }
  });

  it('dowel-edge depth > 0 and ≤ boardThicknessB (blind bore in end panel)', () => {
    const r = generateDowel(swappedSideBottomJoint(), defaults);
    for (const b of r.boresB) {
      expect(typeof b.depth).toBe('number');
      expect(b.depth as number).toBeGreaterThan(0);
      expect(b.depth as number).toBeLessThanOrEqual(18); // boardThicknessB = 18
    }
  });

  it('dowel-edge u must be thickness-centerline ≈9 (Left face, u in [0,18])', () => {
    const r = generateDowel(swappedSideBottomJoint(), defaults);
    for (const b of r.boresB) {
      expect(b.u).toBeGreaterThanOrEqual(0);
      expect(b.u).toBeLessThanOrEqual(18);
      expect(b.u).toBeCloseTo(9, 1); // boardThicknessB / 2 = 9
    }
  });

  it('dowel-edge v must be the along-joint spacing (60/277/494), same as confirmat', () => {
    const r = generateDowel(swappedSideBottomJoint(), defaults);
    const vs = r.boresB.map((b) => b.v).sort((a, b) => a - b);
    const expectedSpacings = [60, 277, 494];
    expect(vs).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(vs[i]).toBeCloseTo(expectedSpacings[i]!, 1);
    }
  });
});
