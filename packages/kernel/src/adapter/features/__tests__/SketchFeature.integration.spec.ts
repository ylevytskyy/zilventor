import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../../../occt/occtLoader';
import { executeSketchFeature, disposeSketchResult } from '../SketchFeature';

let occt: OcctInstance;
beforeAll(async () => { occt = await loadOcct(); }, 60_000);

describe('SketchFeature — rectangle on XY', () => {
  it('produces a closed wire from a single rectangle', () => {
    const result = executeSketchFeature(occt, {
      kind: 'sketch',
      id: 's1',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [{ id: 'p1', kind: 'rectangle', x: 0, y: 0, w: 100, h: 200 }],
      constraints: []
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.closed).toBe(true);
      disposeSketchResult(occt, result.value);
    }
  });

  it('rejects non-XY planes in MVP', () => {
    const result = executeSketchFeature(occt, {
      kind: 'sketch',
      id: 's1',
      plane: { source: 'workPlane', featureId: 'origin.XZ' },
      primitives: [{ id: 'p1', kind: 'rectangle', x: 0, y: 0, w: 100, h: 200 }],
      constraints: []
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('invalidParameter');
  });

  it('rejects an empty sketch with a degenerateSketch error', () => {
    const result = executeSketchFeature(occt, {
      kind: 'sketch',
      id: 's1',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [],
      constraints: []
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('degenerateSketch');
  });

  it('executes a sketch with one line + one arc + two lines forming a closed D-shape', () => {
    const result = executeSketchFeature(occt, {
      kind: 'sketch', id: 's1', plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [
        { id: 'p1', kind: 'line', x1: 0, y1: 0, x2: 100, y2: 0 },
        { id: 'p2', kind: 'arc', cx: 100, cy: 50, r: 50, startAngle: -Math.PI / 2, endAngle: Math.PI / 2 },
        { id: 'p3', kind: 'line', x1: 100, y1: 100, x2: 0, y2: 100 },
        { id: 'p4', kind: 'line', x1: 0, y1: 100, x2: 0, y2: 0 }
      ],
      constraints: []
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.closed).toBe(true);
      disposeSketchResult(occt, result.value);
    }
  });

  it('returns degenerateSketch error with "not closed" message for open polyline', () => {
    const result = executeSketchFeature(occt, {
      kind: 'sketch', id: 's1', plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [
        { id: 'p1', kind: 'line', x1: 0, y1: 0, x2: 100, y2: 0 },
        { id: 'p2', kind: 'line', x1: 100, y1: 0, x2: 100, y2: 50 }
      ],
      constraints: []
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('degenerateSketch');
      expect(result.error.message).toMatch(/not closed/i);
    }
  });

  it('returns "multiple loops" error for two rectangles', () => {
    const result = executeSketchFeature(occt, {
      kind: 'sketch', id: 's1', plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [
        { id: 'p1', kind: 'rectangle', x: 0, y: 0, w: 100, h: 100 },
        { id: 'p2', kind: 'rectangle', x: 200, y: 0, w: 50, h: 50 }
      ],
      constraints: []
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('degenerateSketch');
      expect(result.error.message).toMatch(/multiple/i);
    }
  });

  it('returns "empty" error for a sketch with no primitives', () => {
    const result = executeSketchFeature(occt, {
      kind: 'sketch', id: 's1', plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [], constraints: []
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/empty/i);
  });

  it('executeSketchFeature result has NamedShape with empty faceNames', () => {
    const sketchFeature = {
      kind: 'sketch' as const, id: 'S1', plane: { source: 'workPlane', featureId: 'origin.XY' } as const,
      primitives: [{ id: 'R1', kind: 'rectangle' as const, x: 0, y: 0, w: 10, h: 10 }],
      constraints: []
    };
    const r = executeSketchFeature(occt, sketchFeature);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Sketch doesn't produce faces — faceNames is empty. The naming is
      // attached by downstream features (extrude/revolve) that do.
      expect(r.value.named).toBeDefined();
      expect(r.value.named.faceNames).toEqual([]);
      disposeSketchResult(occt, r.value);
    }
  });
});
