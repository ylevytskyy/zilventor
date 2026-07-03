import { describe, it, expect } from 'vitest';
import { buildTenonMortiseCutters, generateTenonMortisePair, layoutTenonsAlongJoint } from '../tenonMortiseMath';
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
    // Raw v range = [9-(9+1), 9+(9+1)] = [-1,19] pokes 1mm past the host's v=0 edge —
    // clamped (shifted, span preserved) into [0,20] → y = -200 + v = [-200,-180].
    expect(yMin).toBeCloseTo(-200, 6);
    expect(yMax).toBeCloseTo(-180, 6);
    // span = crossSpan + 2*fitClearance = 18 + 2 = 20 — nowhere near the host's 400mm width.
    expect(yMax - yMin).toBeCloseTo(18 + 2 * 1, 6);
  });

  it('mortise cross-axis bounds are clamped into [0,crossLen] when crossSpan exceeds a small host panel\'s extent', () => {
    // Left face, host panel width=20 (crossLen=vLen=20 for axis:'u'). Mating panel
    // thickness=30 → crossSpan=30 alone already exceeds the 20mm host extent, so the
    // bounded window [crossPosition-crossHalf, crossPosition+crossHalf] spills past
    // BOTH edges of the panel — before the fix this silently produced a cutter box
    // that pokes outside the panel solid.
    const smallDims = { length: 600, width: 20, thickness: 18 };
    const spec: TenonMortiseSpec = {
      role: 'mortise', faceRole: 'Left', axis: 'u', position: 100, width: 10, depth: 8,
      count: 1, spacing: 0, fitClearance: 1, crossPosition: 15, crossSpan: 30,
    };
    const [box] = buildTenonMortiseCutters(smallDims, spec);
    // Left face: vDir=+Y, origin.y = -hW = -10. Host panel spans y in [-10,10].
    const yMin = Math.min(box!.p1.y, box!.p2.y), yMax = Math.max(box!.p1.y, box!.p2.y);
    expect(yMin).toBeGreaterThanOrEqual(-10 - 1e-6);
    expect(yMax).toBeLessThanOrEqual(10 + 1e-6);
    // Span exceeds the host extent (crossSpan+2*fitClearance=32 > 20) → shrunk to the
    // full available extent (20mm), not left unclamped.
    expect(yMax - yMin).toBeCloseTo(20, 6);
  });

  it('mortise cross-axis window is shifted (not truncated) into bounds when only crossPosition overflows near an edge', () => {
    // Left face, host panel width=400 (crossLen=vLen=400). crossPosition=395 near the
    // edge with a modest crossSpan=18 → the window [385,405] (span=20, fits within 400)
    // overflows past v=400 by 5mm on the high side only.
    const spec: TenonMortiseSpec = {
      role: 'mortise', faceRole: 'Left', axis: 'u', position: 100, width: 10, depth: 8,
      count: 1, spacing: 0, fitClearance: 1, crossPosition: 395, crossSpan: 18,
    };
    const [box] = buildTenonMortiseCutters(dims, spec);
    // Left face: vDir=+Y, origin.y = -hW = -200. Host panel spans y in [-200,200].
    const yMin = Math.min(box!.p1.y, box!.p2.y), yMax = Math.max(box!.p1.y, box!.p2.y);
    expect(yMax).toBeLessThanOrEqual(200 + 1e-6);
    // Full span (18+2*1=20) is PRESERVED — shifted into bounds, not shrunk — so the
    // mating tenon still fits.
    expect(yMax - yMin).toBeCloseTo(20, 6);
    expect(yMax).toBeCloseTo(200, 6); // shifted flush against the edge
    expect(yMin).toBeCloseTo(180, 6);
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

  it('mortise axis is v when faceA is an edge-shaped face (Left/Right/Front/Back) — mirrors makeBores per-side swapUV', () => {
    // faceA='Left' → endFaceUsesZforU('Left')=true (uDir=+Z there per face2DFrame) →
    // the shared `position` (along-joint) value lands on v, not u (fix/bore-aside-swapuv:
    // generateTenonMortisePair's mortiseAxis now consults joint.faceA, same as makeBores'
    // side-A fix, instead of being hardcoded to 'u').
    const joint = makeJoint('Left', 'Top');
    const { mortise } = generateTenonMortisePair(
      joint,
      { width: 10, depth: 8, count: 1, spacing: 0, fitClearance: 1 },
      { tenonId: 't', mortiseId: 'm', pairId: 'p' },
    );
    expect(mortise.axis).toBe('v');
  });

  it('mortise axis is u when faceA is Top/Bottom (thickness is not on u for that face)', () => {
    const joint = makeJoint('Top', 'Left'); // faceA='Top' → endFaceUsesZforU('Top')=false
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
    // faceA='Left' -> mortiseAxis='v' post-fix (fix/bore-aside-swapuv): the shared
    // along-joint `position`(350) now lands on v (panel-local Y, the RUN/width axis),
    // and the crossPosition/crossSpan mating-footprint bound lands on u (panel-local Z,
    // the host's OWN thickness axis, uLen=18 per faceExtents('Left')).
    //   - cross (u/Z) window: crossPosition(9) +/- (crossSpan(18)/2 + fitClearance(1)) =
    //     [-1,19], a 20mm span that EXCEEDS the host's own 18mm thickness ->
    //     buildTenonMortiseCutters clamps it to the full [0,18] extent (span=18).
    //   - run (v/Y) window: position(350) +/- (width(10)/2 + fitClearance(1)) = [344,356]
    //     -> panel-local y = origin.y(-250) + [344,356] = [94,106], span=12.
    const joint = makeJoint('Left', 'Top', 700);
    const { mortise } = generateTenonMortisePair(
      joint,
      { width: 10, depth: 8, count: 1, spacing: 0, fitClearance: 1 },
      { tenonId: 't', mortiseId: 'm', pairId: 'p' },
    );
    const [box] = buildTenonMortiseCutters(joint.panelA.dims, mortise);
    const zMin = Math.min(box!.p1.z, box!.p2.z), zMax = Math.max(box!.p1.z, box!.p2.z);
    expect(zMax - zMin).toBeCloseTo(18, 6); // clamped to the host's own 18mm thickness
    const yMin = Math.min(box!.p1.y, box!.p2.y), yMax = Math.max(box!.p1.y, box!.p2.y);
    expect(yMax - yMin).toBeCloseTo(10 + 2 * 1, 6); // width(10) + 2xfitClearance(1)
    expect(yMax - yMin).toBeLessThan(500); // nowhere near the host panel's full 500mm width
  });
});

describe('layoutTenonsAlongJoint — auto-derived count/spacing from joint edge length (P11)', () => {
  it('count-mode: fits cleanly within the usable span (default margin = width)', () => {
    // jointLength=400, margin defaults to width=8 → usableSpan = 400-16 = 384.
    // count=3 → spacing = usableSpan/(count-1) = 384/2 = 192.
    const result = layoutTenonsAlongJoint(400, { mode: 'count', value: 3, width: 8 });
    expect(result.count).toBe(3);
    expect(result.spacing).toBeCloseTo(192, 6);
    expect(result.clamped).toBe(false);
  });

  it('pitch-mode: derives a sane count and recalculates spacing to land evenly', () => {
    // usableSpan=384, target pitch=100 → gaps=3.84 → round=4 → count=5.
    // spacing recalculated = 384/4 = 96 (close to the 100mm target, not identical).
    const result = layoutTenonsAlongJoint(400, { mode: 'pitch', value: 100, width: 8 });
    expect(result.count).toBe(5);
    expect(result.spacing).toBeCloseTo(96, 6);
    expect(result.clamped).toBe(false);
  });

  it('count=1: spacing is 0, never NaN', () => {
    const result = layoutTenonsAlongJoint(200, { mode: 'count', value: 1, width: 8 });
    expect(result.count).toBe(1);
    expect(result.spacing).toBe(0);
    expect(Number.isNaN(result.spacing)).toBe(false);
  });

  it('edge too short for the requested count: clamps to the largest feasible count (>=1), clamped=true', () => {
    // usableSpan = 50-16 = 34; maxCount = floor(34/8)+1 = 5 tenons of width 8 fit.
    const result = layoutTenonsAlongJoint(50, { mode: 'count', value: 10, width: 8 });
    expect(result.count).toBe(5);
    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(result.spacing).toBeCloseTo(8.5, 6);
    expect(result.clamped).toBe(true);
  });

  it('requested count exactly at the feasible boundary: not clamped', () => {
    // Same usableSpan=34 as above; maxCount=5 and requestedCount=5 — exact fit, no clamp.
    const result = layoutTenonsAlongJoint(50, { mode: 'count', value: 5, width: 8 });
    expect(result.count).toBe(5);
    expect(result.spacing).toBeCloseTo(8.5, 6);
    expect(result.clamped).toBe(false);
  });

  it('minEndMargin override widens/narrows the usable span independent of width (D3)', () => {
    // jointLength=400, margin overridden to 20 (vs width=8 default) → usableSpan = 400-40 = 360.
    const result = layoutTenonsAlongJoint(400, { mode: 'count', value: 3, width: 8, minEndMargin: 20 });
    expect(result.count).toBe(3);
    expect(result.spacing).toBeCloseTo(180, 6); // 360/2
    expect(result.clamped).toBe(false);
  });
});
