import { describe, it, expect } from 'vitest';
import { buildTenonMortiseCutters, generateTenonMortisePair } from '../tenonMortiseMath';
import type { TenonMortiseSpec } from '../tenonMortise';
import { crossCoord, type JointInput } from '../connectorCatalog';

const dims = { length: 600, width: 400, thickness: 18 };

describe('buildTenonMortiseCutters — panel-local cutter boxes', () => {
  it('count=1 tenon on Right end face: width along v, full thickness along u, protrudes +depth outward', () => {
    // Right face: origin {hL,hW,0}, uDir +Z (thickness=18), vDir -Y (width), normal +X.
    const spec: TenonMortiseSpec = {
      role: 'tenon', faceRole: 'Right', axis: 'v', position: 100, width: 10, depth: 8,
      count: 1, spacing: 0, fitClearance: 1,
    };
    const boxes = buildTenonMortiseCutters(dims, spec);
    expect(boxes).toHaveLength(1);
    const { p1, p2 } = boxes[0]!;

    // u (thickness, +Z): full extent 0..18, no overcut for a tenon.
    const zMin = Math.min(p1.z, p2.z), zMax = Math.max(p1.z, p2.z);
    expect(zMin).toBeCloseTo(0, 6);
    expect(zMax).toBeCloseTo(18, 6);

    // depth along +X (normal +X): face at x=+300, protrudes outward to x=308, no undercut.
    const xMin = Math.min(p1.x, p2.x), xMax = Math.max(p1.x, p2.x);
    expect(xMin).toBeCloseTo(300, 6);
    expect(xMax).toBeCloseTo(308, 6);

    // v (width axis, vDir=-Y): width 10 centered at position 100 → v spans [95,105].
    // origin.y = hW = 200; y = 200 - v → v=95 → y=105; v=105 → y=95.
    const yMin = Math.min(p1.y, p2.y), yMax = Math.max(p1.y, p2.y);
    expect(yMin).toBeCloseTo(95, 6);
    expect(yMax).toBeCloseTo(105, 6);
  });

  it('count=1 mortise on Left face: width widened by fitClearance vs a tenon of the same nominal width', () => {
    const tenonSpec: TenonMortiseSpec = {
      role: 'tenon', faceRole: 'Left', axis: 'v', position: 100, width: 10, depth: 8,
      count: 1, spacing: 0, fitClearance: 1.5,
    };
    const mortiseSpec: TenonMortiseSpec = { ...tenonSpec, role: 'mortise' };

    const [tenonBox] = buildTenonMortiseCutters(dims, tenonSpec);
    const [mortiseBox] = buildTenonMortiseCutters(dims, mortiseSpec);

    // Left face: uDir +Z, vDir +Y, so v maps directly to y (origin.y = -hW = -200).
    const tenonYSpan = Math.abs(tenonBox!.p2.y - tenonBox!.p1.y);
    const mortiseYSpan = Math.abs(mortiseBox!.p2.y - mortiseBox!.p1.y);
    expect(tenonYSpan).toBeCloseTo(10, 6); // nominal width
    expect(mortiseYSpan).toBeCloseTo(10 + 2 * 1.5, 6); // widened by fitClearance on each side

    // Mortise depth: OVERCUT proud outward (x < -300) + (depth+fitClearance) inward (x > -300).
    // Left face normal is -X, face plane at x=-300; inward (into the panel) is +X.
    const mortiseXMin = Math.min(mortiseBox!.p1.x, mortiseBox!.p2.x);
    const mortiseXMax = Math.max(mortiseBox!.p1.x, mortiseBox!.p2.x);
    expect(mortiseXMin).toBeLessThan(-300); // overcut proud of the face
    expect(mortiseXMax).toBeCloseTo(-300 + (8 + 1.5), 6); // cut (depth+fitClearance) into the panel

    // Tenon depth: no overcut, protrudes to exactly -300-8 outward from -300 along -X normal.
    const tenonXMin = Math.min(tenonBox!.p1.x, tenonBox!.p2.x);
    const tenonXMax = Math.max(tenonBox!.p1.x, tenonBox!.p2.x);
    expect(tenonXMax).toBeCloseTo(-300, 6);
    expect(tenonXMin).toBeCloseTo(-308, 6);
  });

  it('count=2 produces two discrete tabs at the correct spacing and position', () => {
    const spec: TenonMortiseSpec = {
      role: 'tenon', faceRole: 'Right', axis: 'v', position: 100, width: 10, depth: 8,
      count: 2, spacing: 40, fitClearance: 0,
    };
    const boxes = buildTenonMortiseCutters(dims, spec);
    expect(boxes).toHaveLength(2);

    // centers at 100 - 20 = 80 and 100 + 20 = 120 (position ± spacing/2 for count=2).
    // vDir = -Y, origin.y = hW = 200 → v=80 → y=120..; v=120 → y=80.
    const centersY = boxes.map((b) => (b.p1.y + b.p2.y) / 2).sort((a, b) => a - b);
    expect(centersY[0]).toBeCloseTo(200 - 120, 6); // v=120 → y=80
    expect(centersY[1]).toBeCloseTo(200 - 80, 6);  // v=80 → y=120
  });

  it('count=3 produces three discrete tabs centered on position with even spacing', () => {
    const spec: TenonMortiseSpec = {
      role: 'tenon', faceRole: 'Right', axis: 'v', position: 100, width: 10, depth: 8,
      count: 3, spacing: 40, fitClearance: 0,
    };
    const boxes = buildTenonMortiseCutters(dims, spec);
    expect(boxes).toHaveLength(3);
    // v-centers should be 60, 100, 140 → y = 200 - v = 140, 100, 60
    const centersY = boxes.map((b) => (b.p1.y + b.p2.y) / 2).sort((a, b) => a - b);
    expect(centersY[0]).toBeCloseTo(60, 6);
    expect(centersY[1]).toBeCloseTo(100, 6);
    expect(centersY[2]).toBeCloseTo(140, 6);
  });

  it('mortise with crossPosition/crossSpan bounds the pocket to the mating footprint, not the full host cross-axis', () => {
    // Left face, dims {600,400,18}: origin {-300,-200,0}, uDir +Z, vDir +Y, faceExtents vLen=400 (host width).
    // Without crossPosition/crossSpan the cross axis (v) would span the FULL 400mm host width — a through-dado.
    const spec: TenonMortiseSpec = {
      role: 'mortise', faceRole: 'Left', axis: 'u', position: 100, width: 10, depth: 8,
      count: 1, spacing: 0, fitClearance: 1, crossPosition: 9, crossSpan: 18,
    };
    const [box] = buildTenonMortiseCutters(dims, spec);
    const yMin = Math.min(box!.p1.y, box!.p2.y), yMax = Math.max(box!.p1.y, box!.p2.y);
    // v range = [9-(9+1), 9+(9+1)] = [-1,19] → y = -200 + v = [-201,-181].
    expect(yMin).toBeCloseTo(-201, 6);
    expect(yMax).toBeCloseTo(-181, 6);
    // span = crossSpan + 2*fitClearance = 18 + 2 = 20 — nowhere near the host's 400mm width.
    expect(yMax - yMin).toBeCloseTo(18 + 2 * 1, 6);
  });

  it('mortise without crossPosition/crossSpan keeps the legacy full-cross-extent behavior', () => {
    const spec: TenonMortiseSpec = {
      role: 'mortise', faceRole: 'Left', axis: 'u', position: 100, width: 10, depth: 8,
      count: 1, spacing: 0, fitClearance: 1,
    };
    const [box] = buildTenonMortiseCutters(dims, spec);
    const yMin = Math.min(box!.p1.y, box!.p2.y), yMax = Math.max(box!.p1.y, box!.p2.y);
    expect(yMin).toBeCloseTo(-200, 6);
    expect(yMax).toBeCloseTo(200, 6); // full host width (400mm) — unchanged legacy path
  });
});

describe('generateTenonMortisePair — cross-face role/axis mapping', () => {
  function makeJoint(faceA: JointInput['faceA'], endB: JointInput['endB'], len = 700): JointInput {
    return {
      line: { p0: { x: 0, y: 0, z: 0 }, p1: { x: len, y: 0, z: 0 } },
      panelA: { dims: { length: 800, width: 500, thickness: 18 },
        pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
      panelB: { dims: { length: len, width: 500, thickness: 18 },
        pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
      faceA, endB,
      boardThicknessA: 18,
      boardThicknessB: 18,
    };
  }

  it('places the tenon on endB and the mortise on faceA, sharing one caller-supplied pairId', () => {
    const joint = makeJoint('Left', 'Top');
    const { tenon, mortise } = generateTenonMortisePair(
      joint,
      { width: 10, depth: 8, count: 2, spacing: 40, fitClearance: 1 },
      { tenonId: 'ten-1', mortiseId: 'mor-1', pairId: 'pair-xyz' },
    );
    expect(tenon.kind).toBe('tenonMortise');
    expect(tenon.role).toBe('tenon');
    expect(tenon.faceRole).toBe('Top'); // endB
    expect(tenon.id).toBe('ten-1');

    expect(mortise.role).toBe('mortise');
    expect(mortise.faceRole).toBe('Left'); // faceA
    expect(mortise.id).toBe('mor-1');

    expect(tenon.pairId).toBe('pair-xyz');
    expect(mortise.pairId).toBe('pair-xyz');
  });

  it('defaults position to half the joint length when omitted', () => {
    const joint = makeJoint('Left', 'Top', 700);
    const { tenon, mortise } = generateTenonMortisePair(
      joint,
      { width: 10, depth: 8, count: 1, spacing: 0, fitClearance: 1 },
      { tenonId: 't', mortiseId: 'm', pairId: 'p' },
    );
    expect(tenon.position).toBeCloseTo(350, 6);
    expect(mortise.position).toBeCloseTo(350, 6);
  });

  it('uses the caller-supplied position verbatim on both sides when provided', () => {
    const joint = makeJoint('Left', 'Top', 700);
    const { tenon, mortise } = generateTenonMortisePair(
      joint,
      { width: 10, depth: 8, count: 1, spacing: 0, fitClearance: 1, position: 222 },
      { tenonId: 't', mortiseId: 'm', pairId: 'p' },
    );
    expect(tenon.position).toBeCloseTo(222, 6);
    expect(mortise.position).toBeCloseTo(222, 6);
  });

  it('mortise axis is always u (side-A along-joint convention, mirrors makeBores)', () => {
    const joint = makeJoint('Left', 'Top');
    const { mortise } = generateTenonMortisePair(
      joint,
      { width: 10, depth: 8, count: 1, spacing: 0, fitClearance: 1 },
      { tenonId: 't', mortiseId: 'm', pairId: 'p' },
    );
    expect(mortise.axis).toBe('u');
  });

  it('tenon axis is v when endB is an edge face that puts thickness on u (Left/Right/Front/Back)', () => {
    const joint = makeJoint('Left', 'Right'); // endB='Right' → endFaceUsesZforU(true)
    const { tenon } = generateTenonMortisePair(
      joint,
      { width: 10, depth: 8, count: 1, spacing: 0, fitClearance: 1 },
      { tenonId: 't', mortiseId: 'm', pairId: 'p' },
    );
    expect(tenon.axis).toBe('v');
  });

  it('tenon axis is u when endB is Top/Bottom (thickness is not on u for that face)', () => {
    const joint = makeJoint('Left', 'Top'); // endB='Top' → endFaceUsesZforU(false)
    const { tenon } = generateTenonMortisePair(
      joint,
      { width: 10, depth: 8, count: 1, spacing: 0, fitClearance: 1 },
      { tenonId: 't', mortiseId: 'm', pairId: 'p' },
    );
    expect(tenon.axis).toBe('u');
  });

  it('carries width/depth/count/spacing/fitClearance verbatim onto both features', () => {
    const joint = makeJoint('Left', 'Top');
    const { tenon, mortise } = generateTenonMortisePair(
      joint,
      { width: 12, depth: 7, count: 3, spacing: 30, fitClearance: 0.5 },
      { tenonId: 't', mortiseId: 'm', pairId: 'p' },
    );
    for (const f of [tenon, mortise]) {
      expect(f.width).toBe(12);
      expect(f.depth).toBe(7);
      expect(f.count).toBe(3);
      expect(f.spacing).toBe(30);
      expect(f.fitClearance).toBe(0.5);
    }
  });

  it('populates the mortise crossPosition/crossSpan from crossCoord(boardThicknessB) and the mating panel thickness; leaves the tenon unset', () => {
    const joint = makeJoint('Left', 'Top'); // boardThicknessB = 18 → crossCoord(18) = 9
    const { tenon, mortise } = generateTenonMortisePair(
      joint,
      { width: 10, depth: 8, count: 1, spacing: 0, fitClearance: 1 },
      { tenonId: 't', mortiseId: 'm', pairId: 'p' },
    );
    expect(mortise.crossPosition).toBeCloseTo(crossCoord(18), 6);
    expect(mortise.crossPosition).toBeCloseTo(9, 6);
    expect(mortise.crossSpan).toBeCloseTo(18, 6); // mating (tenon-host) panel's thickness

    expect(tenon.crossPosition).toBeUndefined();
    expect(tenon.crossSpan).toBeUndefined();
  });

  it('falls back to panelB.dims.thickness for crossSpan/crossPosition when boardThicknessB is absent', () => {
    const joint = makeJoint('Left', 'Top');
    delete (joint as { boardThicknessB?: number }).boardThicknessB;
    const { mortise } = generateTenonMortisePair(
      joint,
      { width: 10, depth: 8, count: 1, spacing: 0, fitClearance: 1 },
      { tenonId: 't', mortiseId: 'm', pairId: 'p' },
    );
    expect(mortise.crossSpan).toBeCloseTo(joint.panelB.dims.thickness, 6);
    expect(mortise.crossPosition).toBeCloseTo(crossCoord(joint.panelB.dims.thickness), 6);
  });

  it('end-to-end: the generated mortise pocket is bounded to the mating panel footprint, not a through-dado across the host face', () => {
    // panelA (Left face host) is 500mm wide; a through-dado would span the full 500mm.
    const joint = makeJoint('Left', 'Top', 700);
    const { mortise } = generateTenonMortisePair(
      joint,
      { width: 10, depth: 8, count: 1, spacing: 0, fitClearance: 1 },
      { tenonId: 't', mortiseId: 'm', pairId: 'p' },
    );
    const [box] = buildTenonMortiseCutters(joint.panelA.dims, mortise);
    const yMin = Math.min(box!.p1.y, box!.p2.y), yMax = Math.max(box!.p1.y, box!.p2.y);
    const span = yMax - yMin;
    expect(span).toBeCloseTo(18 + 2 * 1, 6); // mating thickness (18) + 2×fitClearance(1)
    expect(span).toBeLessThan(500); // nowhere near the host panel's full 500mm width
  });
});
