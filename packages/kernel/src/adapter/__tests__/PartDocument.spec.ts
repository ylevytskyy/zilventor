import { describe, it, expect } from 'vitest';
import { newPart, addFeature, setParameter, removeParameter, removeFeature, addPrimitive, removePrimitive } from '../PartDocument';

describe('PartDocument', () => {
  it('creates an empty part with defaults', () => {
    const p = newPart('Part1');
    expect(p.name).toBe('Part1');
    expect(p.units).toBe('mm');
    expect(p.featureTree).toEqual([]);
    expect(p.id).toMatch(/[0-9a-f-]{36}/);
  });

  it('appends features in order', () => {
    let p = newPart('Part1');
    p = addFeature(p, { kind: 'sketch', id: 's1', plane: 'XY', primitives: [] });
    p = addFeature(p, { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward' });
    expect(p.featureTree.map((f) => f.id)).toEqual(['s1', 'e1']);
  });

  it('setParameter creates or updates by name', () => {
    let p = newPart('Part1');
    p = setParameter(p, { name: 'd1', expression: '18', value: 18, unit: 'mm' });
    expect(p.parameters.d1!.value).toBe(18);
    p = setParameter(p, { name: 'd1', expression: '36', value: 36, unit: 'mm' });
    expect(p.parameters.d1!.value).toBe(36);
  });

  it('removeParameter deletes by name', () => {
    let p = newPart('P');
    p = setParameter(p, { name: 'd1', expression: '18', value: 18, unit: 'mm' });
    p = removeParameter(p, 'd1');
    expect(p.parameters.d1).toBeUndefined();
  });

  it('addFeature does not mutate the input', () => {
    const p1 = newPart('Part1');
    const p2 = addFeature(p1, { kind: 'sketch', id: 's1', plane: 'XY', primitives: [] });
    expect(p1.featureTree.length).toBe(0);
    expect(p2.featureTree.length).toBe(1);
    expect(p1).not.toBe(p2);
  });

  it('removeFeature deletes by id and preserves order', () => {
    let p = newPart('P');
    p = addFeature(p, { kind: 'sketch', id: 's1', plane: 'XY', primitives: [] });
    p = addFeature(p, { kind: 'sketch', id: 's2', plane: 'XY', primitives: [] });
    p = addFeature(p, { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward' });
    p = removeFeature(p, 's1');
    expect(p.featureTree.map((f) => f.id)).toEqual(['s2', 'e1']);
  });

  it('removeFeature on non-existent id is a no-op', () => {
    let p = newPart('P');
    p = addFeature(p, { kind: 'sketch', id: 's1', plane: 'XY', primitives: [] });
    const p2 = removeFeature(p, 'nonexistent');
    expect(p2.featureTree).toEqual(p.featureTree);
  });

  it('addPrimitive appends to a sketch feature\'s primitives', () => {
    let p = newPart('P');
    p = addFeature(p, { kind: 'sketch', id: 's1', plane: 'XY', primitives: [] });
    p = addPrimitive(p, 's1', { id: 'p1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 10 });
    const sketch = p.featureTree[0] as { primitives: Array<{ id: string }> };
    expect(sketch.primitives.map((pr) => pr.id)).toEqual(['p1']);
  });

  it('addPrimitive throws when sketch id not found', () => {
    const p = newPart('P');
    expect(() => addPrimitive(p, 'missing', { id: 'p1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 10 })).toThrow(/no sketch/);
  });

  it('removePrimitive filters by id, preserves order', () => {
    let p = newPart('P');
    p = addFeature(p, { kind: 'sketch', id: 's1', plane: 'XY', primitives: [] });
    p = addPrimitive(p, 's1', { id: 'p1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 10 });
    p = addPrimitive(p, 's1', { id: 'p2', kind: 'line', x1: 10, y1: 10, x2: 20, y2: 20 });
    p = removePrimitive(p, 's1', 'p1');
    const sketch = p.featureTree[0] as { primitives: Array<{ id: string }> };
    expect(sketch.primitives.map((pr) => pr.id)).toEqual(['p2']);
  });
});
