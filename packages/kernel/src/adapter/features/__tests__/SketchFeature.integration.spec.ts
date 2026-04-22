import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../../../occt/occtLoader';
import { executeSketchFeature, disposeSketchResult } from '../SketchFeature';

let occt: OcctInstance;
beforeAll(async () => { occt = await loadOcct(); }, 60_000);

describe('SketchFeature — rectangle on XY', () => {
  it('produces a closed wire with 4 edges', () => {
    const result = executeSketchFeature(occt, {
      kind: 'sketch',
      id: 's1',
      plane: 'XY',
      primitives: [{ kind: 'rectangle', x: 0, y: 0, w: 100, h: 200 }]
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.edgeCount).toBe(4);
      expect(result.value.closed).toBe(true);
      disposeSketchResult(occt, result.value);
    }
  });

  it('rejects non-XY planes in MVP', () => {
    const result = executeSketchFeature(occt, {
      kind: 'sketch',
      id: 's1',
      plane: 'XZ',
      primitives: [{ kind: 'rectangle', x: 0, y: 0, w: 100, h: 200 }]
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('invalidParameter');
  });

  it('rejects sketches that are not a single rectangle', () => {
    const result = executeSketchFeature(occt, {
      kind: 'sketch',
      id: 's1',
      plane: 'XY',
      primitives: []
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('degenerateSketch');
  });
});
