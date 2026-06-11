/**
 * CHUNK G — Task G.2: real-OCCT hinge MoveConnector guard.
 *
 * After a coupled hinge move (translateConnectorAlong),
 * bake the cup + plates into real panels and assert in WORLD space:
 *   1. Cup center (world-Z) shifted exactly by Δ from original.
 *   2. Both plates' centers (world-Z) shifted exactly by Δ from original.
 *   3. Cup and plates co-height invariant: relative Z gap unchanged.
 *   4. The two plate holes remain PLATE_PAIR_SPACING apart along world-Z (spacing invariant).
 *
 * Correction 5: Adds BASELINE pre-move volume-drop test (proves generator correctness before move).
 *
 * Flip-to-RED: negate cup.u increment in translateConnectorAlong → cup shifts by −Δ while
 * plates shift by +Δ, breaking the co-height assert.
 *
 * Door pose: DOOR_POSE quaternion [0.5,0.5,0.5,-0.5] (standing upright, height = world-Z).
 * Side pose: 90° rotation around world-Y so part-X (height) → world-Z; quaternion [0,√2/2,0,√2/2].
 * The non-identity side pose is LOAD-BEARING: translateConnectorAlong must rotate the face axes
 * by the panel's quaternion — with identity quaternion on native side dims the height direction
 * would map to world-X not world-Z, masking quaternion bugs.
 *
 * No-WASM for translateConnectorAlong itself (pure math); OCCT used only to confirm
 * the moved bores land on the correct face (volume drop > 0 after bake).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../../../occt/occtLoader';
import { buildPanelBox } from '../../../occt/PanelOps';
import { executeHoleFeature } from '../HoleFeature';
import {
  hingeCupBores,
  hingePlateBores,
  hingePositions,
  hingeCountForHeight,
  translateConnectorAlong,
  face2DFrame,
  PLATE_PAIR_SPACING,
  CUP_DIAMETER,
  CUP_DEPTH,
  DOOR_CUP_FACE,
  LEFT_SIDE_INNER_FACE,
  DOOR_POSE,
  type ConnectorMember,
} from '@zilventor/shared';
import type { NamedShape } from '../../../occt/FaceNaming';
import type { OcctShape } from '../../../occt/SolidOps';

// Fixture: 600×720mm cabinet, Tc=18mm, D=560mm
const H = 720, D = 560, Tc = 18;
const DOOR_H = H - 2 * Tc;  // 684mm door height
const DOOR_W = 596, Td = 18;
const DOOR_DIMS = { length: DOOR_H, width: DOOR_W, thickness: Td };
// Side panel: UNSWAPPED native dims (length=H, width=D, thickness=Tc)
const SIDE_DIMS = { length: H, width: D, thickness: Tc };

// Door world pose: DOOR_POSE quaternion [0.5,0.5,0.5,-0.5]
// Part-X (doorH/height) → world-Z; part-Y (doorW/width) → world-X
const DOOR_WORLD_POSE = {
  translation: { x: 0, y: 0, z: 0 },
  quaternion: DOOR_POSE.quaternion,
};

// Side panel world pose: -90° rotation around world-Y maps part-X (height=H) → world-Z.
// This is a NON-IDENTITY pose required so translateConnectorAlong must apply the quaternion.
// Quaternion for -90° around +Y: [qx=0, qy=-sin(45°)=-√2/2, qz=0, qw=cos(45°)=√2/2].
// Part-X (1,0,0) → world-Z (0,0,1) ✓  (check: +90° around Y maps +X→-Z; -90° maps +X→+Z)
const SIN45 = Math.SQRT2 / 2;
const SIDE_WORLD_POSE = {
  translation: { x: 0, y: 0, z: 0 },
  quaternion: [0, -SIN45, 0, SIN45] as [number, number, number, number],
};

// Move delta: 20mm along world-Z (the height axis for both door and side with these poses)
const DELTA = 20;
const WORLD_DIR = { x: 0, y: 0, z: 1 }; // world-Z = height direction

/** Compute world-space 3D position of a bore center given the panel world pose. */
function worldBorePos(
  bore: { u: number; v: number; face: { role: string } },
  dims: { length: number; width: number; thickness: number },
  worldPose: { translation: { x: number; y: number; z: number }; quaternion: [number, number, number, number] },
): { x: number; y: number; z: number } {
  const frame = face2DFrame(dims, bore.face.role as 'Top' | 'Bottom' | 'Left' | 'Right' | 'Front' | 'Back');
  // Part-local position
  const lx = frame.origin.x + frame.uDir.x * bore.u + frame.vDir.x * bore.v;
  const ly = frame.origin.y + frame.uDir.y * bore.u + frame.vDir.y * bore.v;
  const lz = frame.origin.z + frame.uDir.z * bore.u + frame.vDir.z * bore.v;
  // Rotate by world quaternion (Hamilton product via double cross-product formula)
  const [qx, qy, qz, qw] = worldPose.quaternion;
  const tx = 2 * (qy * lz - qz * ly);
  const ty = 2 * (qz * lx - qx * lz);
  const tz = 2 * (qx * ly - qy * lx);
  return {
    x: lx + qw * tx + qy * tz - qz * ty + worldPose.translation.x,
    y: ly + qw * ty + qz * tx - qx * tz + worldPose.translation.y,
    z: lz + qw * tz + qx * ty - qy * tx + worldPose.translation.z,
  };
}

describe('CHUNK G.2 — hinge MoveConnector world-space co-height + spacing guard (real OCCT)', () => {
  let oc: any;
  beforeAll(async () => { oc = await loadOcct(); });

  function buildNamedPanel(
    dims: { length: number; width: number; thickness: number },
  ): NamedShape {
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

  function boreFeature(bore: { face: { role: string; featureId: string; instance: number }; u: number; v: number; diameter: number; depth: number | 'throughAll' }): any {
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
      termination: bore.depth === 'throughAll'
        ? { kind: 'throughAll' }
        : { kind: 'distance', depth: { kind: 'literal', value: bore.depth } },
      flipAxis: false,
    };
  }

  // Correction 5: BASELINE test — proves generator correctness BEFORE any move
  it('BASELINE (unmoved): hinge cup bore volume-drop ≈ expected cylinder — proves generator correctness before any move', () => {
    const count = hingeCountForHeight(DOOR_H);
    const us = hingePositions(DOOR_H, count);
    const cups = hingeCupBores(DOOR_DIMS, DOOR_CUP_FACE, 'left', 'full', us);

    // Use the first cup bore UNMOVED
    const cup0 = cups[0]!;
    expect(cup0.u).toBeGreaterThan(0);
    expect(cup0.u).toBeLessThan(DOOR_H);

    const doorPanel = buildNamedPanel(DOOR_DIMS);
    const volBefore = DOOR_H * DOOR_W * Td;

    const result = executeHoleFeature(oc, doorPanel, boreFeature(cup0), (p: any) => p.value, new Map());
    const drop = volBefore - volumeOf(result.shape);

    // Cup: Ø35 (r=17.5), depth=CUP_DEPTH=12mm → cylinder ≈ π×17.5²×12 ≈ 11,539mm³
    const expectedCyl = Math.PI * (CUP_DIAMETER / 2) ** 2 * CUP_DEPTH;
    expect(drop).toBeGreaterThan(expectedCyl * 0.75); // within 25% (OCCT tolerance)
    expect(drop).toBeLessThan(expectedCyl * 1.5);     // not through the panel
    expect(drop).toBeGreaterThan(500); // sanity: definitely cut something
  });

  it('translateConnectorAlong: cup + plates shift by Δ along world-Z (non-identity side pose); co-height + spacing preserved', () => {
    // Generate a 2-hinge door (DOOR_H=684mm → 2 hinges)
    const count = hingeCountForHeight(DOOR_H);
    expect(count).toBe(2); // fixture sanity
    const us = hingePositions(DOOR_H, count);

    const cups = hingeCupBores(DOOR_DIMS, DOOR_CUP_FACE, 'left', 'full', us);
    // Side panel plates — UNSWAPPED native dims per hingePlateBores contract
    const plates = hingePlateBores(SIDE_DIMS, LEFT_SIDE_INNER_FACE, us, 37);

    // Take hinge-0: cup + its 2 plates
    const cup0 = cups.find((b) => b.connectorId === 'hinge-0')!;
    const hingePs = plates.filter((b) => b.connectorId === 'hinge-0');
    expect(hingePs.length).toBe(2);

    // Snapshot original world positions for cup and plates
    const cupWorldBefore = worldBorePos(cup0, DOOR_DIMS, DOOR_WORLD_POSE);
    const plateWorldsBefore = hingePs.map((p) => worldBorePos(p, SIDE_DIMS, SIDE_WORLD_POSE));

    // Note: cup and plates may have different absolute world-Z because the translation origins are both (0,0,0)
    // and the local part-frame offsets differ. That's expected. The invariant is that BOTH shift by DELTA.

    // Build ConnectorMember array for translateConnectorAlong
    const cupClone = { ...cup0 };
    const plateClones = hingePs.map((p) => ({ ...p }));

    const members: ConnectorMember[] = [
      { bore: cupClone, panelDims: DOOR_DIMS, worldPose: DOOR_WORLD_POSE },
      ...plateClones.map((p) => ({
        bore: p,
        panelDims: SIDE_DIMS,
        worldPose: SIDE_WORLD_POSE,
      })),
    ];

    translateConnectorAlong(members, WORLD_DIR, DELTA);

    // Compute world positions after move
    const cupWorldAfter = worldBorePos(cupClone, DOOR_DIMS, DOOR_WORLD_POSE);
    const plateWorldsAfter = plateClones.map((p) => worldBorePos(p, SIDE_DIMS, SIDE_WORLD_POSE));

    // 1. Cup shifted by DELTA along world-Z
    expect(cupWorldAfter.z - cupWorldBefore.z).toBeCloseTo(DELTA, 3);
    // X and Y barely changed (only Z moves for this worldDir)
    expect(Math.abs(cupWorldAfter.x - cupWorldBefore.x)).toBeLessThan(0.1);

    // 2. Both plates shifted by DELTA along world-Z
    for (let i = 0; i < plateWorldsAfter.length; i++) {
      expect(plateWorldsAfter[i]!.z - plateWorldsBefore[i]!.z).toBeCloseTo(DELTA, 3);
    }

    // 3. Relative spacing invariant: the DIFFERENCE between cup world-Z and plate mid world-Z
    // is the same before and after the move (both shifted by DELTA, so gap is preserved).
    const plateMidZBefore = (plateWorldsBefore[0]!.z + plateWorldsBefore[1]!.z) / 2;
    const plateMidZAfter = (plateWorldsAfter[0]!.z + plateWorldsAfter[1]!.z) / 2;
    const gapBefore = cupWorldBefore.z - plateMidZBefore;
    const gapAfter = cupWorldAfter.z - plateMidZAfter;
    expect(Math.abs(gapAfter - gapBefore)).toBeLessThan(0.01); // gap preserved to 0.01mm

    // 4. Plate spacing invariant: the two plates remain PLATE_PAIR_SPACING apart along world-Z
    // With SIDE_WORLD_POSE (part-X → world-Z), the two plate holes ±PLATE_PAIR_SPACING/2
    // around the hinge u are separated by PLATE_PAIR_SPACING in world-Z.
    const spacingBefore = Math.abs(plateWorldsBefore[1]!.z - plateWorldsBefore[0]!.z);
    expect(spacingBefore).toBeCloseTo(PLATE_PAIR_SPACING, 3); // sanity before move
    const spacingAfter = Math.abs(plateWorldsAfter[1]!.z - plateWorldsAfter[0]!.z);
    expect(spacingAfter).toBeCloseTo(PLATE_PAIR_SPACING, 3); // spacing preserved after move
  });

  it('OCCT: moved cup bore still cuts a real void in the door panel (volume drops)', () => {
    const count = hingeCountForHeight(DOOR_H);
    const us = hingePositions(DOOR_H, count);
    const cups = hingeCupBores(DOOR_DIMS, DOOR_CUP_FACE, 'left', 'full', us);
    const cup0 = { ...cups[0]! };

    const members: ConnectorMember[] = [
      { bore: cup0, panelDims: DOOR_DIMS, worldPose: DOOR_WORLD_POSE },
    ];
    translateConnectorAlong(members, WORLD_DIR, DELTA);

    // Moved cup must still land on the door face (within door bounds)
    expect(cup0.u).toBeGreaterThan(0);
    expect(cup0.u).toBeLessThan(DOOR_H);

    // Bake into real OCCT door panel and assert volume drops
    const doorPanel = buildNamedPanel(DOOR_DIMS);
    const volBefore = DOOR_H * DOOR_W * Td;
    const result = executeHoleFeature(oc, doorPanel, boreFeature(cup0), (p: any) => p.value, new Map());
    const drop = volBefore - volumeOf(result.shape);
    const cyl = Math.PI * (CUP_DIAMETER / 2) ** 2 * CUP_DEPTH;
    expect(drop).toBeGreaterThan(cyl * 0.8); // real void cut
    expect(drop).toBeLessThan(Math.PI * (CUP_DIAMETER / 2) ** 2 * Td); // blind, not through
  });

  it('FLIP-TO-RED: non-identity SIDE_WORLD_POSE makes the quaternion path exercise; identity pose gives du=dv=0', () => {
    // Prove that the SIDE_WORLD_POSE quaternion is load-bearing:
    // With IDENTITY pose on SIDE_DIMS (native), the 'Top' face uDir=(1,0,0) stays world-X.
    // Moving along WORLD_DIR=(0,0,1): dot(Z, X) = 0 → du = 0 → plate DOES NOT MOVE.
    // With NON-IDENTITY pose (90° around Y), uDir becomes world-Z → dot(Z, Z) = 1 → du = DELTA.
    const count = hingeCountForHeight(DOOR_H);
    const us = hingePositions(DOOR_H, count);
    const plates = hingePlateBores(SIDE_DIMS, LEFT_SIDE_INNER_FACE, us, 37);
    const originalU = plates.find((b) => b.connectorId === 'hinge-0')!.u;

    // Case A: with SIDE_WORLD_POSE (90° around Y), translateConnectorAlong MOVES the plate
    const plateA = { ...plates.find((b) => b.connectorId === 'hinge-0')! };
    const membersA: ConnectorMember[] = [
      { bore: plateA, panelDims: SIDE_DIMS, worldPose: SIDE_WORLD_POSE },
    ];
    translateConnectorAlong(membersA, WORLD_DIR, DELTA);
    // With part-X → world-Z (via 90° around Y), u shifts by DELTA
    expect(plateA.u - originalU).toBeCloseTo(DELTA, 3); // bore.u moved by DELTA

    // Case B: with IDENTITY pose, translateConnectorAlong does NOT move the plate (du=dv=0)
    const plateB = { ...plates.find((b) => b.connectorId === 'hinge-0')! };
    const identityPose = { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as [number, number, number, number] };
    const membersB: ConnectorMember[] = [
      { bore: plateB, panelDims: SIDE_DIMS, worldPose: identityPose },
    ];
    translateConnectorAlong(membersB, WORLD_DIR, DELTA);
    // With identity pose: uDir=(1,0,0)=world-X, dot(world-Z, world-X)=0 → du=0
    // vDir=(0,1,0)=world-Y, dot(world-Z, world-Y)=0 → dv=0
    expect(plateB.u).toBe(originalU); // bore.u UNCHANGED
    expect(plateB.v).toBe(plates.find((b) => b.connectorId === 'hinge-0')!.v); // bore.v UNCHANGED

    // This proves that if translateConnectorAlong ignored the quaternion (used raw uDir/vDir
    // instead of rotate(uDir, q)), the non-identity test would fail (du would be wrong).
    // The identity-pose case would silently pass either way — the non-identity pose is required.
    expect(plateA.u).not.toBe(plateB.u); // A moved, B didn't → quaternion makes a difference
  });
});
