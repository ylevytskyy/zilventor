/**
 * PHASE 9 — Hinge-cup bake guard (real OCCT).
 *
 * Anti-false-green: feeds the REAL hingeCupBores() generator output (NOT hand-authored)
 * into executeHoleFeature on a REAL buildPanelBox door part
 * {length:doorH, width:doorW, thickness:Td}, and asserts:
 *   - Ø35 cup volume drop on the broad carcass-facing door face (DOOR_CUP_FACE),
 *   - each cup is BLIND (depth < Td; residual material remains, no through-pierce),
 *   - correct hinge count = hingeCountForHeight(doorH),
 *   - the cup lands within CUP_SETBACK[overlay] of the CORRECT hinge edge for BOTH
 *     hingeSide values:
 *        hingeSide 'left'  → v = CUP_SETBACK[overlay]         (edge at v=0)
 *        hingeSide 'right' → v = doorW − CUP_SETBACK[overlay]  (edge at v=doorW)
 *
 * DOOR_CUP_FACE is imported from prisadkaFaceConventions (the Phase-0 contract constant).
 * No local re-declaration of 'Bottom'/'Top' — wrong constant turns Phase-0 A4/B2 RED.
 * The cup is a large-Ø shallow blind hole; no new kernel surface (spec §11).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../../../occt/occtLoader';
import { buildPanelBox } from '../../../occt/PanelOps';
import { executeHoleFeature } from '../HoleFeature';
import {
  hingeCupBores,
  hingePositions,
  hingeCountForHeight,
  CUP_SETBACK,
  CUP_DIAMETER,
  CUP_DEPTH,
  face2DFrame,
  DOOR_CUP_FACE,
} from '@zilventor/shared';
import type { BoreOp } from '@zilventor/shared';
import type { NamedShape } from '../../../occt/FaceNaming';
import type { OcctShape } from '../../../occt/SolidOps';

// REAL full-overlay door on a 600×720 cabinet (doorMath full single: doorW=W-2r, doorH=H-2r).
const DOOR_H = 716, DOOR_W = 596, Td = 18;
const DOOR_DIMS = { length: DOOR_H, width: DOOR_W, thickness: Td };
// DOOR_CUP_FACE imported from conventions — no local 'Bottom'/'Top' literal.
const OVERLAY: 'full' | 'half' | 'inset' = 'full';

describe('PHASE 9 — hinge-cup bake guard (real OCCT)', () => {
  let oc: any;
  beforeAll(async () => { oc = await loadOcct(); });

  function buildNamed(dims: { length: number; width: number; thickness: number }): NamedShape {
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

  function boreFeature(bore: BoreOp): any {
    return {
      id: `bake:${bore.face.role}:${bore.diameter}:${bore.depth}:0`,
      kind: 'hole',
      placement: {
        kind: 'atFace',
        faceName: bore.face,
        points: [{ u: bore.u, v: bore.v }],
        axis: 'into-face',
      },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: bore.diameter } },
      termination: { kind: 'distance', depth: { kind: 'literal', value: bore.depth } },
      flipAxis: false,
    };
  }

  function genCups(hingeSide: 'left' | 'right'): BoreOp[] {
    const us = hingePositions(DOOR_H, hingeCountForHeight(DOOR_H));
    return hingeCupBores(DOOR_DIMS, DOOR_CUP_FACE, hingeSide, OVERLAY, us);
  }

  it('hinge count = hingeCountForHeight(doorH); cups are Ø35 blind, role hingeCup', () => {
    // ANTI-FALSE-GREEN: calls hingeCupBores (the GENERATED output), never hand-authored coordinates.
    const count = hingeCountForHeight(DOOR_H);
    const cups = genCups('left');
    expect(cups.length).toBe(count);
    for (const c of cups) {
      expect(c.role).toBe('hingeCup');
      expect(c.connectorKind).toBe('hinge');
      expect(c.diameter).toBe(CUP_DIAMETER); // 35
      expect(c.depth).toBe(CUP_DEPTH);        // 12, blind
      expect(c.depth as number).toBeLessThan(Td);
      // face.role must equal the imported DOOR_CUP_FACE constant — no local literal.
      expect(c.face.role).toBe(DOOR_CUP_FACE);
    }
  });

  it("hingeSide 'left' → cups at v = CUP_SETBACK[overlay] (edge at v=0)", () => {
    // ANTI-FALSE-GREEN: the v-edge assertion is on GENERATED bores, not hand-authored.
    const cups = genCups('left');
    for (const c of cups) {
      expect(c.v).toBeCloseTo(CUP_SETBACK[OVERLAY], 3);
      expect(c.u).toBeGreaterThanOrEqual(0);
      expect(c.u).toBeLessThanOrEqual(DOOR_H); // u = hinge position along doorH
    }
  });

  it("hingeSide 'right' → cups at v = doorW − CUP_SETBACK[overlay] (edge at v=doorW)", () => {
    // ANTI-FALSE-GREEN: the hingeSide-dependent v assignment is tested geometrically.
    // A wrong 'right' edge (using CUP_SETBACK instead of doorW - CUP_SETBACK) fails here.
    const cups = genCups('right');
    for (const c of cups) {
      expect(c.v).toBeCloseTo(DOOR_W - CUP_SETBACK[OVERLAY], 3);
    }
  });

  it('OCCT: a generated Ø35 cup cuts a real BLIND void on the broad door face (residual remains)', () => {
    // ANTI-FALSE-GREEN: feeds the FIRST cup from hingeCupBores (not hand-authored) into
    // executeHoleFeature and asserts the volume drop matches a blind Ø35 bore.
    // A wrong face (e.g. 'Front' instead of DOOR_CUP_FACE='Bottom') would either fail to
    // find the face (error) or produce a very different volume drop (wrong panel dimension).
    const cups = genCups('left');
    const cup = cups[0]!;
    const depth = cup.depth as number;
    expect(depth).toBeLessThan(Td); // blind

    const volBefore = DOOR_H * DOOR_W * Td;
    const running = buildNamed(DOOR_DIMS);
    const result = executeHoleFeature(oc, running, boreFeature(cup), (p: any) => p.value, new Map());
    const drop = volBefore - volumeOf(result.shape);

    const cyl = Math.PI * 17.5 * 17.5 * depth; // Ø35 r=17.5
    expect(drop).toBeGreaterThan(1000);
    expect(drop).toBeGreaterThan(cyl * 0.9);
    expect(drop).toBeLessThan(cyl * 1.4); // BLIND: not a through-pierce
    // A through cup would drop ≈ π·17.5²·Td; assert strictly less (residual material).
    expect(drop).toBeLessThan(Math.PI * 17.5 * 17.5 * Td);
  });

  it('OCCT: the generated cup lands near the correct part-local 3D point for the hinge edge', () => {
    // Cross-check the producer (u,v) against face2DFrame so a u/v swap or wrong-edge bug is
    // caught geometrically (the slice-1 class), independent of the bake volume.
    // Uses DOOR_CUP_FACE imported from conventions — no local literal.
    const cup = genCups('left')[0]!;
    const frame = face2DFrame(DOOR_DIMS, DOOR_CUP_FACE);
    const Px = frame.origin.x + frame.uDir.x * cup.u + frame.vDir.x * cup.v;
    const Py = frame.origin.y + frame.uDir.y * cup.u + frame.vDir.y * cup.v;
    // DOOR_CUP_FACE = 'Bottom': origin (-doorH/2, +doorW/2, 0), uDir +X, vDir -Y.
    // v=CUP_SETBACK[full]=21 from the v=0 edge → Py = +doorW/2 − CUP_SETBACK.
    // u along doorH → Px = -doorH/2 + u. Assert both are within the door footprint.
    expect(Px).toBeGreaterThanOrEqual(-DOOR_H / 2 - 1e-3);
    expect(Px).toBeLessThanOrEqual(DOOR_H / 2 + 1e-3);
    expect(Py).toBeGreaterThanOrEqual(-DOOR_W / 2 - 1e-3);
    expect(Py).toBeLessThanOrEqual(DOOR_W / 2 + 1e-3);
    // Specifically: for 'left' hingeSide, cup is at v=CUP_SETBACK[full]=21.
    // Bottom vDir=-Y so Py = +doorW/2 - 21 = 277.
    expect(Py).toBeCloseTo(DOOR_W / 2 - CUP_SETBACK[OVERLAY], 3);
  });
});
