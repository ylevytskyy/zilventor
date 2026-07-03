/**
 * LOCKING TEST — bSwapUV-for-side-A defect (fix/bore-aside-swapuv).
 *
 * BUG (connectorCatalog.ts makeBores, ~line 105): `bSwapUV` only consults
 * `endFaceUsesZforU(j.endB)` for side==='B'. For side==='A' it is always
 * false, so every A-side bore on an edge-shaped faceA (Left/Right/Front/Back
 * — where face2DFrame's uDir is the board-thickness axis) writes the
 * along-joint spacing (60/277/494mm) into `u` instead of `v`. Since
 * faceExtents caps uLen at the board thickness (18mm) for those faces, u=60
 * is 42mm past the panel edge — the drill origin lands OUTSIDE the solid and
 * executeHoleFeature removes 0.000 mm³ (confirmat-face holes silently never
 * exist on side panels).
 *
 * Two sub-suites:
 *
 * 1. "self-consistent frame" — bakes boresA into a panel built with the SAME
 *    dims the generator was given (JointInput.panelA.dims, the L↔T-SWAPPED
 *    dims GenerateCarcassBoresCommand feeds jointMath for side panels). This
 *    isolates and fully validates the ASSIGNED u/v-swap fix: after the fix,
 *    the bore lands at the correct coordinate and cuts a normal Ø7×18mm
 *    confirmat-face hole (~693mm³), matching theory almost exactly.
 *
 * 2. "real production frame" — bakes the SAME boresA into a panel built with
 *    the REAL (unswapped) dims the leftSide PartDocument's own PanelFeature
 *    actually stores (baseCabinet.ts: length=height=720, thickness=18 — see
 *    GenerateCarcassBoresCommand.ts:110-121, "the opposite of the physical
 *    orientation") — i.e. exactly what BakeBoresCommand does with these
 *    bores in production, AFTER GenerateCarcassBoresCommand's persistence-time
 *    `syntheticSideBoreToReal` remap (fix/bore-aside-swapuv slice 2). The RAW
 *    boresA (role 'Right'/'Left', unremapped) still reproduce the diagnosed
 *    ~27,709mm³ 720mm-long-channel defect — 'Right'/'Left' name the panel's thin
 *    18mm EDGE face in the real frame, not its flat face. This suite locks that
 *    `syntheticSideBoreToReal(bore)` fixes it: the remapped bore (role 'Top'/'Bottom')
 *    bakes a normal ~693mm³ confirmat-face hole through the real 18mm board thickness.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../../../occt/occtLoader';
import { buildPanelBox } from '../../../occt/PanelOps';
import { executeHoleFeature } from '../HoleFeature';
import { generateConfirmat, syntheticSideBoreToReal, type JointInput, type BoringParams } from '@zilventor/shared';
import type { NamedShape } from '../../../occt/FaceNaming';
import type { OcctShape } from '../../../occt/SolidOps';

const W_CAB = 600, D = 560, H = 720, Tc = 18, Tb = 6;
const BORING_PARAMS: BoringParams = { endSetback: 60, maxSpacing: 250, minCount: 2 };

/** The REAL leftSide PartDocument dims (baseCabinet.ts: length=height, width=depth, thickness=board). */
const SIDE_DIMS_REAL = { length: H, width: D, thickness: Tc }; // 720x560x18
/** The L<->T-SWAPPED dims GenerateCarcassBoresCommand feeds jointMath as panelA.dims for side panels. */
const SIDE_DIMS_SWAPPED = { length: Tc, width: D, thickness: H }; // 18x560x720
const BOTTOM_DIMS = { length: W_CAB - 2 * Tc, width: D - Tb, thickness: Tc }; // 564x554x18

/** Identical joint fixture to HoleFeature.catalogBore.integration.spec.ts's realCabinetJoint(). */
function realCabinetJoint(): JointInput {
  return {
    line: { p0: { x: Tc, y: Tb, z: Tc / 2 }, p1: { x: Tc, y: D, z: Tc / 2 } },
    panelA: {
      dims: SIDE_DIMS_SWAPPED,
      pose: { translation: { x: Tc / 2, y: D / 2, z: H / 2 }, quaternion: [0, 0, 0, 1] },
    },
    panelB: {
      dims: BOTTOM_DIMS,
      pose: {
        translation: { x: Tc + BOTTOM_DIMS.length / 2, y: Tb + BOTTOM_DIMS.width / 2, z: BOTTOM_DIMS.thickness / 2 },
        quaternion: [0, 0, 0, 1],
      },
    },
    faceA: 'Right',
    endB: 'Left',
    boardThicknessA: Tc,
    boardThicknessB: Tc,
  };
}

describe('bSwapUV-for-side-A fix — real OCCT bake (kernel integration)', () => {
  let oc: any;
  beforeAll(async () => { oc = await loadOcct(); });

  function buildNamedPanel(dims: { length: number; width: number; thickness: number }): NamedShape {
    const { length: L, width: W, thickness: T } = dims;
    const panel = buildPanelBox(oc, dims);
    const faceNamesArr: NamedShape['faceNames'] = [];
    const map = new oc.TopTools_IndexedMapOfShape_1();
    oc.TopExp.MapShapes_1(panel.shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, map);
    const hL = L / 2, hW = W / 2;
    for (let i = 1; i <= map.Extent(); i++) {
      const faceShape = map.FindKey(i);
      const face = oc.TopoDS.Face_1(faceShape);
      const props = new oc.GProp_GProps_1();
      oc.BRepGProp.SurfaceProperties_1(face, props, 1e-7, false);
      const c = props.CentreOfMass();
      const x = c.X(), y = c.Y(), z = c.Z();
      props.delete?.();
      let role: string;
      if (Math.abs(z - T) < 0.5) role = 'Top';
      else if (Math.abs(z) < 0.5) role = 'Bottom';
      else if (Math.abs(y - hW) < 0.5) role = 'Front';
      else if (Math.abs(y + hW) < 0.5) role = 'Back';
      else if (Math.abs(x + hL) < 0.5) role = 'Left';
      else role = 'Right';
      faceNamesArr.push({ name: { featureId: 'panel', role, instance: 0 }, face });
    }
    map.delete();
    return { shape: panel.shape as unknown as OcctShape, faceNames: faceNamesArr } as NamedShape;
  }

  function volumeOf(shape: unknown): number {
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(shape, props, 1e-7, false, false);
    const v = props.Mass();
    props.delete?.();
    return v;
  }

  function bakeBore(dims: { length: number; width: number; thickness: number }, bore: {
    face: { role: string; featureId: string; instance: number }; u: number; v: number; diameter: number; depth: number | 'throughAll';
  }): number {
    const running = buildNamedPanel(dims);
    const volBefore = dims.length * dims.width * dims.thickness;
    const holeFeature: any = {
      id: `probe:${bore.face.role}:${bore.diameter}:${bore.depth}:${bore.u}:${bore.v}`,
      kind: 'hole',
      placement: {
        kind: 'atFace',
        faceName: bore.face,
        points: [{ u: bore.u, v: bore.v }],
        axis: 'into-face',
      },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: bore.diameter } },
      termination: bore.depth === 'throughAll' ? { kind: 'throughAll' } : { kind: 'distance', depth: { kind: 'literal', value: bore.depth } },
      flipAxis: false,
    };
    const result = executeHoleFeature(oc, running, holeFeature, (p: any) => p.value, new Map());
    return volBefore - volumeOf(result.shape);
  }

  describe('self-consistent frame (panel built with the SAME dims fed into the generator)', () => {
    it('LOCKING: each A-side confirmat-face bore cuts a correct Ø7 through-hole (u,v swapped for faceA)', () => {
      const { boresA } = generateConfirmat(realCabinetJoint(), BORING_PARAMS);
      expect(boresA.length).toBe(3);

      const expectedSpacings = [60, 277, 494];
      for (const b of boresA) {
        // Re-derived golden values (endFaceUsesZforU('Right') is true — Right is an
        // edge-shaped face, uDir=+Z is the thickness axis in the swapped frame too):
        //   u = crossCoord(boardThicknessB) = 18/2 = 9   (thickness-centerline, was WRONGLY `dist` pre-fix)
        //   v = along-joint spacing (60/277/494)          (was WRONGLY constant `9` pre-fix)
        expect(b.u).toBeCloseTo(Tc / 2, 6);
        expect(expectedSpacings.some((s) => Math.abs(b.v - s) < 1)).toBe(true);

        const drop = bakeBore(SIDE_DIMS_SWAPPED, b as any);
        const cyl = Math.PI * (b.diameter / 2) ** 2 * Tc; // through-all over the true 18mm board thickness
        // 0.9-1.4x band per the assignment brief; measured value is a near-exact match (~692.7 vs 692.7).
        expect(drop).toBeGreaterThan(cyl * 0.9);
        expect(drop).toBeLessThan(cyl * 1.4);
      }
    });
  });

  describe('real production frame (panel built with the REAL, unswapped leftSide PartDocument dims)', () => {
    it('DOCUMENTS the pre-remap defect: raw (unremapped) A-side bore cuts a ~27,709mm³ 720mm channel', () => {
      const { boresA } = generateConfirmat(realCabinetJoint(), BORING_PARAMS);
      expect(boresA.length).toBe(3);

      for (const b of boresA) {
        // Raw boresA still carry the SYNTHETIC frame's role ('Right') un-remapped. On
        // SIDE_DIMS_REAL, 'Right' is the panel's thin 18mm EDGE face (normal along the
        // 720mm length axis) — a throughAll hole from there drills the FULL 720mm, not the
        // board's 18mm face: a ~27,709mm³ channel instead of a ~693mm³ confirmat-face hole.
        // This is exactly the residual bug that GenerateCarcassBoresCommand's
        // syntheticSideBoreToReal remap (applied below) fixes.
        expect(b.face.role).toBe('Right');
        const drop = bakeBore(SIDE_DIMS_REAL, b as any);
        const longChannel = Math.PI * (b.diameter / 2) ** 2 * H; // 720mm-long channel (the residual-bug shape)
        expect(drop).toBeGreaterThan(longChannel * 0.9);
        expect(drop).toBeLessThan(longChannel * 1.1);
      }
    });

    it('FIXED: syntheticSideBoreToReal-remapped A-side bore cuts a correct ~693mm³ confirmat-face hole', () => {
      const { boresA } = generateConfirmat(realCabinetJoint(), BORING_PARAMS);
      expect(boresA.length).toBe(3);

      const expectedSpacings = [60, 277, 494];
      const seenV = new Set<number>();
      for (const b of boresA) {
        const remapped = syntheticSideBoreToReal(b);
        // 'Right' (synthetic, edge-shaped face) -> 'Top' (real, flat face normal to the
        // real 18mm thickness axis) — see syntheticSideBoreToReal's derivation comment.
        expect(remapped.face.role).toBe('Top');
        // u/v carry over verbatim: u = crossCoord(boardThicknessB) = 9 (length-axis position
        // near one end); v = along-joint spacing (60/277/494, width-axis position).
        expect(remapped.u).toBeCloseTo(Tc / 2, 6);
        expect(expectedSpacings.some((s) => Math.abs(remapped.v - s) < 1)).toBe(true);
        seenV.add(Math.round(remapped.v));

        const drop = bakeBore(SIDE_DIMS_REAL, remapped as any);
        const cyl = Math.PI * (b.diameter / 2) ** 2 * Tc; // through-all over the true 18mm board thickness
        // 0.9-1.4x band per the assignment brief; measured value is a near-exact match (~692.7 vs 692.7).
        expect(drop).toBeGreaterThan(cyl * 0.9);
        expect(drop).toBeLessThan(cyl * 1.4);
      }
      // Three distinct along-joint positions — the holes are spread along the joint, not stacked.
      expect(seenV.size).toBe(3);
    });
  });
});
