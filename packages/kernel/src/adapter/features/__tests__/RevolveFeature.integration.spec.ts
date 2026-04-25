import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../../../occt/occtLoader';
import { computeBoundingBox, disposeShape } from '../../../occt/SolidOps';
import { executeRevolveFeature } from '../RevolveFeature';
import type { Feature } from '@zilventor/shared';

let oc: OcctInstance;
beforeAll(async () => {
  oc = await loadOcct();
}, 60_000);

describe('executeRevolveFeature (integration)', () => {
  it('revolves a rectangle around an in-sketch line 360 degrees', () => {
    // Rectangle spans [5,15] x [0,5]; axis line lies along the Y axis (x=0).
    // Revolving 360 deg yields an annular disk of outer radius 15, inner
    // radius 5, height 5 -> bbox extent in X should be 30 (from -15 to 15).
    const sketchFeature: Extract<Feature, { kind: 'sketch' }> = {
      kind: 'sketch',
      id: 'S1',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [
        { id: 'R1', kind: 'rectangle', x: 5, y: 0, w: 10, h: 5 },
        { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }
      ],
      constraints: []
    };
    const revolve: Extract<Feature, { kind: 'revolve' }> = {
      kind: 'revolve',
      id: 'REV1',
      sketchRef: 'S1',
      axisPrimitiveId: 'L1',
      angleParam: 'angle0',
      direction: 'normal',
      operation: 'new'
    };

    const r = executeRevolveFeature(oc, sketchFeature, revolve, 2 * Math.PI);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const bbox = computeBoundingBox(oc, r.value.solid);
    // X extent: full revolve around Y -> [-15, 15] -> extent 30
    expect(bbox[3] - bbox[0]).toBeCloseTo(30, 0.5);
    expect(bbox[4] - bbox[1]).toBeCloseTo(5, 0.5);   // Y height
    expect(bbox[5] - bbox[2]).toBeCloseTo(30, 0.5);  // Z diameter

    expect(r.value.named.faceNames.length).toBeGreaterThan(0);
    const roles = r.value.named.faceNames.map((f) => f.name.role);
    // Full 360 deg produces a lateral face (and potentially a top/bottom
    // cap depending on profile geometry). No cap_start/cap_end — the sweep
    // closes on itself so MakeRevol emits no start/end planar trims.
    expect(roles).toContain('lateral');
    expect(roles).not.toContain('cap_start');
    expect(roles).not.toContain('cap_end');
    disposeShape(r.value.solid);
  });

  it('partial 90 deg revolve labels cap_start + cap_end + lateral faces', () => {
    // Rectangle [5,15] x [0,5] revolved 90 deg about the Y axis (x=0).
    // MakeRevol for a partial sweep emits exactly 2 planar cap faces whose
    // planes contain the axis (plane_normal ⊥ axis) — one at angle 0
    // (cap_start) and one at angle +90 (cap_end) — plus the swept lateral
    // surfaces. Instance-order of cap_start vs cap_end is MVP-stable on
    // TopExp_Explorer iteration order for a fixed profile.
    const sketchFeature: Extract<Feature, { kind: 'sketch' }> = {
      kind: 'sketch',
      id: 'S1',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [
        { id: 'R1', kind: 'rectangle', x: 5, y: 0, w: 10, h: 5 },
        { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }
      ],
      constraints: []
    };
    const revolve: Extract<Feature, { kind: 'revolve' }> = {
      kind: 'revolve',
      id: 'REV_partial',
      sketchRef: 'S1',
      axisPrimitiveId: 'L1',
      angleParam: 'angle0',
      direction: 'normal',
      operation: 'new'
    };

    const r = executeRevolveFeature(oc, sketchFeature, revolve, Math.PI / 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Partial revolve produces lateral + two cap faces (cap_start, cap_end).
    const roles = r.value.named.faceNames.map((f) => f.name.role);
    expect(roles).toContain('cap_start');
    expect(roles).toContain('cap_end');
    expect(roles).toContain('lateral');
    // Exactly one cap_start and one cap_end — MakeRevol emits both trims.
    expect(roles.filter((r) => r === 'cap_start')).toHaveLength(1);
    expect(roles.filter((r) => r === 'cap_end')).toHaveLength(1);
    disposeShape(r.value.solid);
  });

  it('symmetric revolve sweeps equally in both directions around the axis', () => {
    // Rectangle [5,15] x [0,5] revolved 90 deg about the Y axis (x=0) line.
    // OCCT's BRepPrimAPI_MakeRevol follows the right-hand rule around the
    // axis direction. With axis going +Y, a profile at +X swept by +90 deg
    // rotates toward -Z.
    //
    // Normal 90-deg sweep (theta in [0, +90]): profile at X=[5,15] sweeps
    //   from (15, 0) at theta=0 to (0, -15) at theta=+90. Bbox Z: [-15, 0].
    //
    // Symmetric 90-deg sweep (theta in [-45, +45]) via pre-rotation of -45:
    //   profile sweeps through +Z AND -Z. Bbox Z: [-10.6, +10.6].
    const sketchFeature: Extract<Feature, { kind: 'sketch' }> = {
      kind: 'sketch',
      id: 'S1',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [
        { id: 'R1', kind: 'rectangle', x: 5, y: 0, w: 10, h: 5 },
        { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }
      ],
      constraints: []
    };

    const symFeature: Extract<Feature, { kind: 'revolve' }> = {
      kind: 'revolve',
      id: 'R_sym',
      sketchRef: 'S1',
      axisPrimitiveId: 'L1',
      angleParam: 'angle0',
      direction: 'symmetric',
      operation: 'new'
    };
    const normFeature: Extract<Feature, { kind: 'revolve' }> = {
      kind: 'revolve',
      id: 'R_norm',
      sketchRef: 'S1',
      axisPrimitiveId: 'L1',
      angleParam: 'angle0',
      direction: 'normal',
      operation: 'new'
    };

    const rSym = executeRevolveFeature(oc, sketchFeature, symFeature, Math.PI / 2);
    const rNorm = executeRevolveFeature(oc, sketchFeature, normFeature, Math.PI / 2);

    expect(rSym.ok).toBe(true);
    expect(rNorm.ok).toBe(true);
    if (!rSym.ok || !rNorm.ok) return;

    const symBBox = computeBoundingBox(oc, rSym.value.solid);
    const normBBox = computeBoundingBox(oc, rNorm.value.solid);

    // Normal 90-deg sweep (0 -> +90): profile at +X rotates only toward -Z.
    // Bbox Z: [-15, 0]. Discriminator: zmax ~ 0 (profile does not enter +Z).
    expect(normBBox[5]).toBeCloseTo(0, 0);

    // Symmetric 90-deg sweep (-45 -> +45): profile sweeps through +Z AND -Z.
    // Bbox Z: [-10.6, +10.6].
    expect(symBBox[5]).toBeGreaterThan(5);    // zmax clearly positive
    expect(symBBox[2]).toBeGreaterThan(-11);  // zmin less negative than normal's -15
    expect(symBBox[2]).toBeLessThan(-5);      // but still clearly in -Z
    // And symmetric around the XZ plane: |zmin| should approximate zmax.
    expect(Math.abs(symBBox[2] + symBBox[5])).toBeLessThan(0.5);

    disposeShape(rSym.value.solid);
    disposeShape(rNorm.value.solid);
  });

  it('returns revolveFailed when axisPrimitiveId is missing', () => {
    const sketchFeature: Extract<Feature, { kind: 'sketch' }> = {
      kind: 'sketch',
      id: 'S1',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [{ id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 10, h: 5 }],
      constraints: []
    };
    const revolve: Extract<Feature, { kind: 'revolve' }> = {
      kind: 'revolve',
      id: 'REV2',
      sketchRef: 'S1',
      axisPrimitiveId: 'NONEXISTENT',
      angleParam: 'angle0',
      direction: 'normal',
      operation: 'new'
    };

    const r = executeRevolveFeature(oc, sketchFeature, revolve, Math.PI);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('revolveFailed');
  });
});
