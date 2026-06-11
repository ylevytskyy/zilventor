/**
 * Task I — OCCT centroid-move bake (drag-gizmo geometry ground-truth).
 *
 * Proves that moving a bore's (u,v) coordinate moves the DRILLED HOLE in real OCCT
 * geometry, not merely that a hole exists. Volume is unchanged by a translation, so
 * we measure the centroid of the removed-material cylinder via the mass-weighted
 * center formula:
 *
 *   c_hole = (m_panel * c_panel − m_bored * c_bored) / (m_panel − m_bored)
 *
 * This works because:
 *   m_panel * c_panel = m_hole * c_hole + m_bored * c_bored
 *   (mass × centroid additivity for a partitioned solid)
 *
 * Anti-false-green guarantee: the assertion checks that the X-coordinate of the
 * hole centroid changed by ≈ 20 mm (the bore's u-shift on the Top face where
 * uDir = +X). A test that merely checks volume drop would pass even if the bore
 * didn't move — this test requires the POSITION to move.
 *
 * Panel geometry (buildPanelBox):
 *   Box: [−L/2, −W/2, 0] .. [L/2, W/2, T] = [−300,−300,0]..[300,300,18]
 *   Top face: uDir=+X, vDir=+Y. Bore at (u,v) → world (−L/2+u, −W/2+v, 18).
 *   u=100 → world X = −200; u=120 → world X = −180; delta = +20 ✓
 *
 * Reuses the harness from HoleFeature.atFace.integration.spec.ts and
 * DrawerSlideBake.integration.spec.ts: loadOcct, buildPanelBox, executeHoleFeature,
 * GProp_GProps, BRepGProp.VolumeProperties_1 / SurfaceProperties_1.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../occt/occtLoader';
import { buildPanelBox } from '../occt/PanelOps';
import { executeHoleFeature } from '../adapter/features/HoleFeature';
import type { NamedShape } from '../occt/FaceNaming';
import type { OcctShape } from '../occt/SolidOps';

// Panel dimensions — same as HoleFeature.atFace.integration.spec.ts for consistency.
const DIMS = { length: 600, width: 600, thickness: 18 };

describe('drag-gizmo bake: moving a bore moves the hole centroid (real OCCT)', () => {
  let oc: any;

  beforeAll(async () => {
    oc = await loadOcct();
  });

  /**
   * Build a NamedShape with centroid-based face role assignment.
   * Reused pattern from HoleFeature.atFace + DrawerSlideBake integration tests.
   */
  function buildNamed(): NamedShape {
    const { length: L, width: W, thickness: T } = DIMS;
    const panel = buildPanelBox(oc, DIMS);
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
      if (Math.abs(z - T) < 0.5)    role = 'Top';
      else if (Math.abs(z) < 0.5)   role = 'Bottom';
      else if (Math.abs(y - hW) < 0.5) role = 'Front';
      else if (Math.abs(y + hW) < 0.5) role = 'Back';
      else if (Math.abs(x + hL) < 0.5) role = 'Left';
      else                              role = 'Right';
      faceNamesArr.push({ name: { featureId: 'panel', role, instance: 0 }, face });
    }
    map.delete();
    return { shape: panel.shape as unknown as OcctShape, faceNames: faceNamesArr } as NamedShape;
  }

  /**
   * Volume + centroid of a solid via BRepGProp.VolumeProperties_1.
   * Returns { mass, cx, cy, cz }.
   */
  function massProps(shape: unknown): { mass: number; cx: number; cy: number; cz: number } {
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(shape, props, 1e-7, false, false);
    const mass = props.Mass();
    const c = props.CentreOfMass();
    const cx = c.X(), cy = c.Y(), cz = c.Z();
    props.delete?.();
    return { mass, cx, cy, cz };
  }

  /**
   * Bake an atFace bore on the Top face, return hole centroid via mass-weighted subtraction.
   * c_hole = (m_panel*c_panel − m_bored*c_bored) / (m_panel − m_bored)
   *
   * Top face: uDir=+X, vDir=+Y.
   *   world_x_of_hole_center = −L/2 + u = −300 + u
   *   world_y_of_hole_center = −W/2 + v = −300 + v
   *   The hole is drilled from z=T=18 downward (into-face = −Z).
   */
  async function bakeAndHoleCentroid(u: number, v: number): Promise<{ x: number; y: number; z: number }> {
    const running = buildNamed();

    // Volume + centroid of the UNCUT panel (same for both bores, but build fresh each call
    // because executeHoleFeature may mutate in-place).
    const unbored = buildNamed();
    const panelProps = massProps(unbored.shape);

    // Build the HoleFeature for an atFace Top bore at (u, v).
    const feature: any = {
      id: `bake:Top:5:12:0`,
      kind: 'hole',
      placement: {
        kind: 'atFace',
        faceName: { featureId: 'panel', role: 'Top', instance: 0 },
        points: [{ u, v }],
        axis: 'into-face',
      },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: 5 } },
      termination: { kind: 'distance', depth: { kind: 'literal', value: 12 } },
      flipAxis: false,
    };

    const result = executeHoleFeature(oc, running, feature, (p: any) => p.value, new Map());
    const boredProps = massProps(result.shape);

    const mPanel = panelProps.mass;
    const mBored = boredProps.mass;
    const mHole = mPanel - mBored;

    // Sanity: hole removed some material (not a no-op)
    expect(mHole).toBeGreaterThan(100);

    // c_hole = (m_panel*c_panel − m_bored*c_bored) / m_hole
    return {
      x: (mPanel * panelProps.cx - mBored * boredProps.cx) / mHole,
      y: (mPanel * panelProps.cy - mBored * boredProps.cy) / mHole,
      z: (mPanel * panelProps.cz - mBored * boredProps.cz) / mHole,
    };
  }

  it('a +20mm u-shift moves the Top-face hole centroid by ~20mm along world X', async () => {
    // Top face: uDir=+X. Bore u=100 → world X = −300+100 = −200.
    //                     Bore u=120 → world X = −300+120 = −180. Delta = +20 along X.
    const c0 = await bakeAndHoleCentroid(100, 200);
    const c1 = await bakeAndHoleCentroid(120, 200);

    console.log(
      `[centroid-move] u=100 → hole.cx=${c0.x.toFixed(3)}, ` +
      `u=120 → hole.cx=${c1.x.toFixed(3)}, delta=${(c1.x - c0.x).toFixed(3)} mm`,
    );

    // The u shift is 20mm along uDir=+X → centroid X moves +20.
    const dX = c1.x - c0.x;
    expect(dX).toBeCloseTo(20, 1);  // ±0.05mm tolerance

    // Y and Z must be essentially unchanged (v same, depth symmetric → z near T−depth/2)
    expect(Math.abs(c1.y - c0.y)).toBeLessThan(0.5);
    expect(Math.abs(c1.z - c0.z)).toBeLessThan(0.5);
  });
});
