/**
 * CHUNK G — Task G.4: regeneration-merge guard using real generator output.
 *
 * Tests the mergeBores() function (Chunk F) on real confirmat output:
 *   1. After edit (bore.edited=true, patched depth), re-Generate with UNCHANGED dims
 *      → the edited bore's depth is PRESERVED (not overwritten by fresh).
 *   2. After delete (suppressed connectorId), re-Generate → the suppressed connector
 *      does NOT reappear.
 *   3. Re-Generate does NOT produce duplicates (the append bug: fresh+existing without merge).
 *
 * Flip-to-RED for (3): replace mergeBores with [...existing, ...fresh] → duplicate count fails.
 * Flip-to-RED for (1): remove `editedById` lookup → edited depth overwritten → depth assert fails.
 * Flip-to-RED for (2): remove suppressed filter → suppressed bore reappears → count assert fails.
 *
 * This test is in the kernel integration suite because it calls loadOcct() to run a real bake
 * and confirm the MERGED bore set cuts real voids — not a unit test of mergeBores alone.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../../../occt/occtLoader';
import { buildPanelBox } from '../../../occt/PanelOps';
import { executeHoleFeature } from '../HoleFeature';
import {
  generateConfirmat,
  mergeBores,
  type JointInput, type BoringParams, type BoreOp,
} from '@zilventor/shared';
import type { NamedShape } from '../../../occt/FaceNaming';
import type { OcctShape } from '../../../occt/SolidOps';

const W_CAB = 600, D = 560, Tc = 18, Tb = 6;
const BOTTOM_DIMS = { length: W_CAB - 2 * Tc, width: D - Tb, thickness: Tc }; // 564×554×18
const BORING_PARAMS: BoringParams = { endSetback: 60, maxSpacing: 250, minCount: 2 };

function realCabinetJoint(): JointInput {
  return {
    line: { p0: { x: Tc, y: Tb, z: Tc / 2 }, p1: { x: Tc, y: D, z: Tc / 2 } },
    panelA: {
      dims: { length: Tc, width: D, thickness: 720 },
      pose: { translation: { x: Tc / 2, y: D / 2, z: 360 }, quaternion: [0, 0, 0, 1] },
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

describe('CHUNK G.4 — mergeBores on real confirmat output + real OCCT bake guard', () => {
  let oc: any;
  beforeAll(async () => { oc = await loadOcct(); });

  function buildBottomPanel(): NamedShape {
    const { length: L, width: W, thickness: T } = BOTTOM_DIMS;
    const panel = buildPanelBox(oc, BOTTOM_DIMS);
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

  it('mergeBores import is available (fails RED without Chunk F)', () => {
    // RED without Chunk F: `mergeBores` not exported from @zilventor/shared
    expect(typeof mergeBores).toBe('function');
  });

  it('(1) edited bore depth is preserved after re-generate with unchanged dims', () => {
    const joint = realCabinetJoint();
    const { boresB: fresh1 } = generateConfirmat(joint, BORING_PARAMS);
    expect(fresh1.length).toBe(3);

    // Simulate EditBoreCommand: mark confirmat-0 B-side bore as edited with new depth
    const targetId = fresh1[0]!.id;
    const editedDepth = 20; // changed from default ~32
    const existing: BoreOp[] = fresh1.map((b) =>
      b.id === targetId ? { ...b, depth: editedDepth, edited: true } : b,
    );

    // Re-generate with SAME dims (no param change)
    const { boresB: fresh2 } = generateConfirmat(joint, BORING_PARAMS);
    // fresh2 IDs must be stable (same joint params → same IDs)
    expect(fresh2[0]!.id).toBe(targetId);

    // Merge: fresh2 is the new generation; existing has the edit
    // RED without Chunk F impl: mergeBores is undefined → TypeError
    const merged = mergeBores(fresh2, existing, undefined);

    expect(merged.length).toBe(3); // no duplicates
    const preservedBore = merged.find((b) => b.id === targetId);
    expect(preservedBore).toBeDefined();
    // The edited depth must be preserved (not overwritten by fresh)
    expect(preservedBore!.depth).toBe(editedDepth);
    expect(preservedBore!.edited).toBe(true);
  });

  it('(2) suppressed connector does not reappear after re-generate', () => {
    const joint = realCabinetJoint();
    const { boresB: fresh1 } = generateConfirmat(joint, BORING_PARAMS);

    // Simulate DeleteConnectorCommand: suppress confirmat-1
    const suppressId = 'confirmat-1';
    const existingAfterDelete: BoreOp[] = fresh1.filter((b) => b.connectorId !== suppressId);
    const suppressed: string[] = [suppressId];

    // Re-generate
    const { boresB: fresh2 } = generateConfirmat(joint, BORING_PARAMS);
    expect(fresh2.some((b) => b.connectorId === suppressId)).toBe(true); // sanity: fresh has it

    // Merge: suppressed filter must prevent resurrection
    // RED without Chunk F: mergeBores missing → TypeError
    const merged = mergeBores(fresh2, existingAfterDelete, suppressed);

    // confirmat-1 should NOT appear in merged
    expect(merged.some((b) => b.connectorId === suppressId)).toBe(false);
    // The other connectors should still be present
    expect(merged.some((b) => b.connectorId === 'confirmat-0')).toBe(true);
    expect(merged.some((b) => b.connectorId === 'confirmat-2')).toBe(true);
  });

  it('(3) re-generate without merge produces DUPLICATES (proving the latent append bug)', () => {
    // This test documents the pre-slice-3 bug: [...existing, ...fresh] duplicates bores.
    // It PASSES by design (demonstrating the bug), is NOT the fix — it's the flip-to-RED witness.
    const joint = realCabinetJoint();
    const { boresB: fresh } = generateConfirmat(joint, BORING_PARAMS);
    const existing = [...fresh]; // simulating run-once-applied state

    // The BUG: appending instead of replacing
    const withBug = [...existing, ...fresh];
    expect(withBug.length).toBe(fresh.length * 2); // duplicates!

    // The FIX: mergeBores replaces (not appends)
    const merged = mergeBores(fresh, existing, undefined);
    expect(merged.length).toBe(fresh.length); // no duplicates
  });

  it('OCCT: merged bore set (edit preserved, suppressed absent) bakes to correct volumes', () => {
    const joint = realCabinetJoint();
    const { boresB: fresh1 } = generateConfirmat(joint, BORING_PARAMS);

    // Edit confirmat-0 depth to 20; suppress confirmat-2
    const editedId = fresh1[0]!.id;
    const newDepth = 20;
    const existing: BoreOp[] = fresh1.map((b) =>
      b.id === editedId ? { ...b, depth: newDepth, edited: true } : b,
    ).filter((b) => b.connectorId !== 'confirmat-2');

    const { boresB: fresh2 } = generateConfirmat(joint, BORING_PARAMS);
    const merged = mergeBores(fresh2, existing, ['confirmat-2']);

    // confirmat-0 bore should have the edited depth
    const editedBore = merged.find((b) => b.id === editedId)!;
    expect(editedBore.depth).toBe(newDepth);
    // confirmat-2 absent
    expect(merged.some((b) => b.connectorId === 'confirmat-2')).toBe(false);
    // 2 bores remain (confirmat-0 + confirmat-1 on B-side; one bore each)
    expect(merged.length).toBe(2);

    // Bake each remaining bore into a real panel and assert volume drop
    for (const bore of merged) {
      const running = buildBottomPanel();
      const depth = bore.depth as number;
      const holeFeature: any = {
        id: `bake:${bore.face.role}:${bore.diameter}:${bore.depth}:0`,
        kind: 'hole',
        placement: {
          kind: 'atFace',
          faceName: bore.face,
          points: [{ u: bore.u, v: bore.v }],
          axis: 'into-face',
        },
        profile: { kind: 'simple', diameter: { kind: 'literal', value: bore.diameter } },
        termination: { kind: 'distance', depth: { kind: 'literal', value: depth } },
        flipAxis: false,
      };
      const result = executeHoleFeature(oc, running, holeFeature, (p: any) => p.value, new Map());
      const volBefore = BOTTOM_DIMS.length * BOTTOM_DIMS.width * BOTTOM_DIMS.thickness;
      const drop = volBefore - volumeOf(result.shape);
      // Each bore must cut a real void (non-zero drop)
      expect(drop).toBeGreaterThan(100);
      const cyl = Math.PI * 2.5 * 2.5 * depth;
      expect(drop).toBeGreaterThan(cyl * 0.8); // ≈ expected cylinder
    }
  });
});
