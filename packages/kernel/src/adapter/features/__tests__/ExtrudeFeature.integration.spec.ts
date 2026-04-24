import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../../../occt/occtLoader';
import { executeSketchFeature } from '../SketchFeature';
import { executeExtrudeFeature } from '../ExtrudeFeature';
import { computeBoundingBox, disposeShape } from '../../../occt/SolidOps';

let occt: OcctInstance;
beforeAll(async () => { occt = await loadOcct(); }, 60_000);

describe('ExtrudeFeature', () => {
  it('extrudes a 100x200 rect by 50 to a 100x200x50 solid', () => {
    const sketch = executeSketchFeature(occt, {
      kind: 'sketch', id: 's1', plane: 'XY', primitives: [{ id: 'p1', kind: 'rectangle', x: 0, y: 0, w: 100, h: 200 }], constraints: []
    });
    expect(sketch.ok).toBe(true);
    if (!sketch.ok) return;

    const ex = executeExtrudeFeature(occt, sketch.value, {
      kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward', operation: 'new'
    }, 50);
    expect(ex.ok).toBe(true);
    if (!ex.ok) return;

    const bb = computeBoundingBox(occt, ex.value.solid);
    expect(bb[0]).toBeCloseTo(0, 5);
    expect(bb[1]).toBeCloseTo(0, 5);
    expect(bb[2]).toBeCloseTo(0, 5);
    expect(bb[3]).toBeCloseTo(100, 5);
    expect(bb[4]).toBeCloseTo(200, 5);
    expect(bb[5]).toBeCloseTo(50, 5);
    disposeShape(ex.value.solid);
  });

  it('rejects non-positive extrude distance', () => {
    const sketch = executeSketchFeature(occt, {
      kind: 'sketch', id: 's1', plane: 'XY', primitives: [{ id: 'p1', kind: 'rectangle', x: 0, y: 0, w: 100, h: 200 }], constraints: []
    });
    expect(sketch.ok).toBe(true);
    if (!sketch.ok) return;

    const ex = executeExtrudeFeature(occt, sketch.value, {
      kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward', operation: 'new'
    }, 0);
    expect(ex.ok).toBe(false);
    if (!ex.ok) expect(ex.error.kind).toBe('invalidParameter');
  });
});
