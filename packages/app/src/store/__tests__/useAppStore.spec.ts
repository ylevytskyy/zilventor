import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../useAppStore';
import type { PartDocument, SketchConstraint, SketchPrimitive } from '@zilventor/shared';

const mkPart = (): PartDocument => ({
  id: 'P1',
  name: 'Part1',
  units: 'mm',
  parameters: {},
  featureTree: [
    { kind: 'sketch', id: 'S1', plane: 'XY', primitives: [], constraints: [] }
  ]
});

describe('useAppStore constraint extensions', () => {
  beforeEach(() => {
    const s = useAppStore.getState();
    s.setActivePart(mkPart());
    s.setSketchDof(null);
  });

  it('setSketchDof stores a DofStatus', () => {
    useAppStore.getState().setSketchDof({ count: 3, state: 'under' });
    expect(useAppStore.getState().sketchDof).toEqual({ count: 3, state: 'under' });
  });

  it('applyCoordDiff patches primitives by id', () => {
    const store = useAppStore.getState();
    const prim: SketchPrimitive = { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 };
    store.addPrimitiveToActiveSketch('S1', prim);
    store.applyCoordDiff('S1', [{ primitiveId: 'L1', patch: { x2: 99 } }]);
    const part = useAppStore.getState().activePart!;
    const sketch = part.featureTree[0] as { primitives: SketchPrimitive[] };
    expect((sketch.primitives[0] as { x2: number }).x2).toBe(99);
  });

  it('addConstraintToActiveSketch appends to the sketch feature', () => {
    const c: SketchConstraint = { id: 'c1', kind: 'horizontal', line: 'L1' };
    useAppStore.getState().addConstraintToActiveSketch('S1', c);
    const sketch = useAppStore.getState().activePart!.featureTree[0] as { constraints: SketchConstraint[] };
    expect(sketch.constraints).toHaveLength(1);
    expect(sketch.constraints[0]!.id).toBe('c1');
  });

  it('removeConstraintFromActiveSketch removes by id', () => {
    const c: SketchConstraint = { id: 'c1', kind: 'horizontal', line: 'L1' };
    useAppStore.getState().addConstraintToActiveSketch('S1', c);
    useAppStore.getState().removeConstraintFromActiveSketch('S1', 'c1');
    const sketch = useAppStore.getState().activePart!.featureTree[0] as { constraints: SketchConstraint[] };
    expect(sketch.constraints).toHaveLength(0);
  });
});

describe('useAppStore dimension CRUD', () => {
  beforeEach(() => {
    useAppStore.getState().setActivePart({
      id: 'P1', name: 'Part1', units: 'mm', parameters: {},
      featureTree: [{ kind: 'sketch', id: 'S1', plane: 'XY', primitives: [], constraints: [] }]
    });
  });

  it('adds a dimension to the active sketch', () => {
    useAppStore.getState().addDimensionToActiveSketch('S1', {
      id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
      value: { kind: 'literal', value: 50 }
    });
    const sketch = useAppStore.getState().activePart!.featureTree[0] as { constraints: unknown[] };
    expect(sketch.constraints).toHaveLength(1);
  });

  it('updates the value of an existing dimension', () => {
    const s = useAppStore.getState();
    s.addDimensionToActiveSketch('S1', {
      id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
      value: { kind: 'literal', value: 50 }
    });
    s.updateDimensionValueInStore('S1', 'd0', 100);
    const sketch = useAppStore.getState().activePart!.featureTree[0] as { constraints: Array<{ value: { value: number } }> };
    expect(sketch.constraints[0]!.value.value).toBe(100);
  });

  it('removes a dimension by id', () => {
    const s = useAppStore.getState();
    s.addDimensionToActiveSketch('S1', {
      id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
      value: { kind: 'literal', value: 50 }
    });
    s.removeDimensionFromActiveSketch('S1', 'd0');
    const sketch = useAppStore.getState().activePart!.featureTree[0] as { constraints: unknown[] };
    expect(sketch.constraints).toHaveLength(0);
  });
});
