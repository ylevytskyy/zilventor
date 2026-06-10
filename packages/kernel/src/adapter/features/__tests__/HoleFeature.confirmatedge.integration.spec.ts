/**
 * Repro / regression test: confirmat-edge bore drilled into the THIN END face
 * (Left or Right) of a bottom/shelf panel via real OCCT.
 *
 * ROOT CAUSE (fixed):
 *   BRepAdaptor_Surface_2.Plane().Axis().Direction() returns the underlying plane's
 *   geometric normal, which does NOT account for face orientation (TopAbs_REVERSED).
 *   For BRepPrimAPI_MakeBox, the three "negative" faces (Left/Back/Bottom) are stored
 *   REVERSED, so their adaptor normal points INWARD. Before the fix, resolveAtFaceLocations
 *   used this wrong inward normal as the "outward" normal, negated it (getting the OUTWARD
 *   direction instead of the inward drill axis), and the cutter was placed OUTSIDE the solid
 *   → zero material removal.
 *
 *   The symptom in production was a different issue upstream (wrong endB='Top'), but once
 *   endB is fixed to 'Left'/'Right', this is the kernel-level fix that makes the bore cut.
 *
 * FIX: resolveAtFaceLocations now computes the body center-of-mass and signs the outward
 * normal correctly: if the adaptor normal points toward the interior (dot with toBody > 0),
 * negate it. This ensures all 6 panel faces get the correct outward normal direction.
 *
 * Tests:
 *   1. [REPRO] Left-face bore (Ø5, depth=32) on a 564×554×18 panel → volume drop ≈ 628mm³.
 *      This is the confirmat-edge geometry for a left-side/bottom-panel joint.
 *   2. [REPRO] Right-face bore — symmetric case, same dimensions.
 *   3. [REPRO] Back-face bore — another "negative" face that previously had wrong normal.
 *   4. [REGRESSION] Front-face bore — previously working, must still pass (positive face).
 *   5. [REGRESSION] Bottom-face bore — previously broken (REVERSED face), depth < T.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../../../occt/occtLoader';
import { buildPanelBox } from '../../../occt/PanelOps';
import { executeHoleFeature } from '../HoleFeature';
import type { NamedShape } from '../../../occt/FaceNaming';
import type { OcctShape } from '../../../occt/SolidOps';

const PANEL_DIMS = { length: 564, width: 554, thickness: 18 };
// Confirmat-edge bore: Ø5, depth=50-T_side(18)=32mm into the END face of a panel.
const CONFIRMAT_DEPTH = 32;
const CONFIRMAT_DIA = 5;

describe('executeHoleFeature — confirmat-edge bore (integration, real OCCT)', () => {
  let oc: any;

  beforeAll(async () => { oc = await loadOcct(); });

  function buildPanel(dims = PANEL_DIMS) {
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

  function confirmEdgeBoreFeature(role: string, u: number, v: number) {
    return {
      id: `bake:${role}:${CONFIRMAT_DIA}:${CONFIRMAT_DEPTH}:0`,
      kind: 'hole',
      placement: {
        kind: 'atFace',
        faceName: { featureId: 'panel', role, instance: 0 },
        points: [{ u, v }],
        axis: 'into-face',
      },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: CONFIRMAT_DIA } },
      termination: { kind: 'distance', depth: { kind: 'literal', value: CONFIRMAT_DEPTH } },
      flipAxis: false,
    } as any;
  }

  const volBefore = PANEL_DIMS.length * PANEL_DIMS.width * PANEL_DIMS.thickness;
  // Expected volume drop: π*r²*depth = π*2.5²*32 ≈ 628.3mm³ (plus drill-tip cone <15%)
  const cylinderVol = Math.PI * 2.5 * 2.5 * CONFIRMAT_DEPTH;

  // face2DFrame('Left', {L=564,W=554,T=18}):
  //   origin={-282,-277,0}, uDir={0,0,1}(Z), vDir={0,1,0}(Y)
  //   u=9 (T_side/2 → height Z=9), v=60 (spacing → Y=-277+60=-217)
  //   P={-282, -217, 9}: on Left face (x=-282), inside panel bounds ✓
  //   Outward normal=-X → axis=+X, depth=32 → bore from x=-282 to x=-250 ✓
  it('[REPRO] Left-face confirmat-edge (Ø5, depth=32) cuts real void — volume drop ≈628mm³', () => {
    const running = buildPanel();
    const result = executeHoleFeature(oc, running, confirmEdgeBoreFeature('Left', 9, 60), (p: any) => p.value, new Map());
    const drop = volBefore - volumeOf(result.shape);
    expect(drop).toBeGreaterThan(100);
    expect(drop).toBeGreaterThan(cylinderVol * 0.9);
    expect(drop).toBeLessThan(cylinderVol * 1.4);
  });

  // face2DFrame('Right', {L=564,W=554,T=18}):
  //   origin={282,277,0}, uDir={0,0,1}(Z), vDir={0,-1,0}(-Y)
  //   u=9, v=60: P={282, 277-60, 9}={282,217,9}: on Right face (x=282) ✓
  //   Outward normal=+X → axis=-X, depth=32 → bore from x=282 to x=250 ✓
  it('[REPRO] Right-face confirmat-edge (Ø5, depth=32) cuts real void — volume drop ≈628mm³', () => {
    const running = buildPanel();
    const result = executeHoleFeature(oc, running, confirmEdgeBoreFeature('Right', 9, 60), (p: any) => p.value, new Map());
    const drop = volBefore - volumeOf(result.shape);
    expect(drop).toBeGreaterThan(100);
    expect(drop).toBeGreaterThan(cylinderVol * 0.9);
    expect(drop).toBeLessThan(cylinderVol * 1.4);
  });

  // face2DFrame('Back', {L=564,W=554,T=18}):
  //   origin={282,-277,0}, uDir={0,0,1}(Z), vDir={-1,0,0}(-X)
  //   u=9, v=60: P={282-60, -277, 9}={222,-277,9}: on Back face (y=-277) ✓
  //   Outward normal=-Y → axis=+Y, depth=32 → bore from y=-277 to y=-245 ✓
  it('[REPRO] Back-face bore (Ø5, depth=32) cuts real void — previously broken REVERSED face', () => {
    const running = buildPanel();
    const result = executeHoleFeature(oc, running, confirmEdgeBoreFeature('Back', 9, 60), (p: any) => p.value, new Map());
    const drop = volBefore - volumeOf(result.shape);
    expect(drop).toBeGreaterThan(100);
    expect(drop).toBeGreaterThan(cylinderVol * 0.9);
    expect(drop).toBeLessThan(cylinderVol * 1.4);
  });

  // face2DFrame('Front', {L=564,W=554,T=18}):
  //   origin={-282,277,0}, uDir={0,0,1}(Z), vDir={1,0,0}(X)
  //   u=9, v=300: P={-282+300, 277, 9}={18,277,9}: on Front face (y=277) ✓
  //   Outward normal=+Y (FORWARD face, was always correct) → axis=-Y, depth=20 ✓
  it('[REGRESSION] Front-face bore (Ø8, depth=20) still cuts real void — previously working', () => {
    const running = buildPanel();
    const feature: any = confirmEdgeBoreFeature('Front', 9, 300);
    feature.profile = { kind: 'simple', diameter: { kind: 'literal', value: 8 } };
    feature.termination = { kind: 'distance', depth: { kind: 'literal', value: 20 } };
    const result = executeHoleFeature(oc, running, feature, (p: any) => p.value, new Map());
    const frontCylVol = Math.PI * 4 * 4 * 20; // ≈1005mm³
    const drop = volBefore - volumeOf(result.shape);
    expect(drop).toBeGreaterThan(100);
    expect(drop).toBeGreaterThan(frontCylVol * 0.9);
    expect(drop).toBeLessThan(frontCylVol * 1.3);
  });

  // face2DFrame('Bottom', {L=564,W=554,T=18}):
  //   origin={-282,277,0}, uDir={1,0,0}(X), vDir={0,-1,0}(-Y)
  //   u=100, v=100: P={-282+100, 277-100, 0}={-182,177,0}: on Bottom face (z=0) ✓
  //   Outward normal=-Z (REVERSED face, was broken before fix) → axis=+Z, depth=10 ✓
  it('[REGRESSION] Bottom-face bore (Ø5, depth=10) cuts real void — previously broken REVERSED face', () => {
    const running = buildPanel();
    const feature: any = confirmEdgeBoreFeature('Bottom', 100, 100);
    feature.termination = { kind: 'distance', depth: { kind: 'literal', value: 10 } };
    const bottomCylVol = Math.PI * 2.5 * 2.5 * 10; // ≈196mm³
    const result = executeHoleFeature(oc, running, feature, (p: any) => p.value, new Map());
    const drop = volBefore - volumeOf(result.shape);
    expect(drop).toBeGreaterThan(10);
    expect(drop).toBeGreaterThan(bottomCylVol * 0.9);
    expect(drop).toBeLessThan(bottomCylVol * 1.4);
  });
});
