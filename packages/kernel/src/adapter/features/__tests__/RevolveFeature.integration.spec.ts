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
      plane: 'XY',
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
    disposeShape(r.value.solid);
  });

  it('returns revolveFailed when axisPrimitiveId is missing', () => {
    const sketchFeature: Extract<Feature, { kind: 'sketch' }> = {
      kind: 'sketch',
      id: 'S1',
      plane: 'XY',
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
