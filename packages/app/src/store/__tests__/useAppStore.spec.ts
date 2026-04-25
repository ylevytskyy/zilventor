import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../useAppStore';
import type { AssemblyDocument, PartDocument, SketchConstraint, SketchPrimitive } from '@zilventor/shared';

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

describe('useAppStore highlightedConstraintIds', () => {
  beforeEach(() => {
    useAppStore.getState().setHighlightedConstraintIds([]);
  });

  it('setHighlightedConstraintIds populates the store', () => {
    useAppStore.getState().setHighlightedConstraintIds(['c1', 'c2']);
    expect(useAppStore.getState().highlightedConstraintIds).toEqual(['c1', 'c2']);
  });

  it('setHighlightedConstraintIds replaces previous value', () => {
    useAppStore.getState().setHighlightedConstraintIds(['c1']);
    useAppStore.getState().setHighlightedConstraintIds(['c3', 'c4']);
    expect(useAppStore.getState().highlightedConstraintIds).toEqual(['c3', 'c4']);
  });

  it('setHighlightedConstraintIds clears with empty array', () => {
    useAppStore.getState().setHighlightedConstraintIds(['c1']);
    useAppStore.getState().setHighlightedConstraintIds([]);
    expect(useAppStore.getState().highlightedConstraintIds).toEqual([]);
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

describe('useAppStore hole dialog slice', () => {
  beforeEach(() => {
    useAppStore.getState().resetHoleDialog();
  });

  it('hole dialog state defaults are sane and openHoleForEdit/resetHoleDialog work', () => {
    const initial = useAppStore.getState();
    expect(initial.holeDialogOpen).toBe(false);
    expect(initial.holePlacementMode).toBe('fromSketch');
    expect(initial.holeSketchId).toBeNull();
    expect(initial.holePlacementFace).toBeNull();
    expect(initial.holeRefEdges).toEqual([null, null]);
    expect(initial.holeCircularEdge).toBeNull();
    expect(initial.holeTargetFace).toBeNull();
    expect(initial.editingHoleId).toBeNull();
    expect(initial.holeInitialValues).toBeNull();

    useAppStore.getState().toggleHoleDialog(true);
    expect(useAppStore.getState().holeDialogOpen).toBe(true);

    // Without a stored hole, openHoleForEdit should still set the editingHoleId + open the dialog,
    // even if no holeInitialValues seed is found (T26 enriches the seed-from-feature path).
    useAppStore.getState().openHoleForEdit('H1');
    expect(useAppStore.getState().editingHoleId).toBe('H1');
    expect(useAppStore.getState().holeDialogOpen).toBe(true);

    useAppStore.getState().resetHoleDialog();
    expect(useAppStore.getState().holeDialogOpen).toBe(false);
    expect(useAppStore.getState().editingHoleId).toBeNull();
    expect(useAppStore.getState().holePlacementMode).toBe('fromSketch');
    expect(useAppStore.getState().holeRefEdges).toEqual([null, null]);
  });

  it('openHoleForEdit seeds placement / picks / initial values from a stored CBORE feature', () => {
    const stored: any = {
      id: 'H1', kind: 'hole',
      placement: { kind: 'linear',
        faceName: { featureId: 'B1', role: 'top' },
        refEdge1: { faceA: { featureId: 'B1', role: 'top' }, faceB: { featureId: 'B1', role: 'front' } },
        offset1: { kind: 'literal', value: 3 },
        refEdge2: { faceA: { featureId: 'B1', role: 'top' }, faceB: { featureId: 'B1', role: 'left' } },
        offset2: { kind: 'literal', value: 4 },
      },
      profile: { kind: 'counterbore',
        diameter: { kind: 'literal', value: 4 },
        cboreDiameter: { kind: 'literal', value: 8 },
        cboreDepth: { kind: 'literal', value: 2 },
      },
      termination: { kind: 'distance', depth: { kind: 'literal', value: 6 } },
      flipAxis: true,
    };
    useAppStore.setState((s) => ({
      ...s,
      activePart: { id: 'P1', name: 'P', units: 'mm', parameters: {}, featureTree: [stored] } as any,
    }));

    useAppStore.getState().openHoleForEdit('H1');
    const s = useAppStore.getState();
    expect(s.holeDialogOpen).toBe(true);
    expect(s.editingHoleId).toBe('H1');
    expect(s.holeInitialValues).toEqual(stored);
    expect(s.holePlacementMode).toBe('linear');
    expect(s.holePlacementFace).toEqual({ featureId: 'B1', role: 'top' });
    expect(s.holeRefEdges[0]).toBeTruthy();
    expect(s.holeRefEdges[1]).toBeTruthy();
  });
});

describe('useAppStore sweep dialog slice', () => {
  beforeEach(() => {
    useAppStore.getState().resetSweepDialog();
  });

  it('sweep dialog state defaults are sane', () => {
    const initial = useAppStore.getState();
    expect(initial.sweepDialogOpen).toBe(false);
    expect(initial.sweepProfileSketchId).toBeNull();
    expect(initial.sweepPathSketchId).toBeNull();
    expect(initial.sweepOrientationKind).toBe('path');
    expect(initial.sweepGuideRailSketchId).toBeNull();
    expect(initial.sweepOperation).toBe('new');
    expect(initial.editingSweepId).toBeNull();
    expect(initial.sweepInitialValues).toBeNull();
  });

  it('toggleSweepDialog opens/closes', () => {
    useAppStore.getState().toggleSweepDialog(true);
    expect(useAppStore.getState().sweepDialogOpen).toBe(true);
    useAppStore.getState().toggleSweepDialog(false);
    expect(useAppStore.getState().sweepDialogOpen).toBe(false);
  });

  it('openSweepForEdit seeds editingSweepId from a stored feature', () => {
    const stored: any = {
      id: 'SW1', kind: 'sweep',
      profileSketchId: 'PROF', pathSketchId: 'PATH',
      orientation: { kind: 'guideRail', guideRailSketchId: 'GUIDE' },
      operation: 'join',
    };
    useAppStore.setState((s) => ({
      ...s,
      activePart: { id: 'P1', name: 'P', units: 'mm', parameters: {}, featureTree: [stored] } as any,
    }));
    useAppStore.getState().openSweepForEdit('SW1');
    const s = useAppStore.getState();
    expect(s.sweepDialogOpen).toBe(true);
    expect(s.editingSweepId).toBe('SW1');
    expect(s.sweepProfileSketchId).toBe('PROF');
    expect(s.sweepPathSketchId).toBe('PATH');
    expect(s.sweepOrientationKind).toBe('guideRail');
    expect(s.sweepGuideRailSketchId).toBe('GUIDE');
    expect(s.sweepOperation).toBe('join');
  });

  it('resetSweepDialog clears all sweep state', () => {
    useAppStore.setState((s) => ({
      ...s,
      sweepDialogOpen: true,
      sweepProfileSketchId: 'X',
      sweepOrientationKind: 'parallel',
      editingSweepId: 'SW',
    }));
    useAppStore.getState().resetSweepDialog();
    const s = useAppStore.getState();
    expect(s.sweepDialogOpen).toBe(false);
    expect(s.sweepProfileSketchId).toBeNull();
    expect(s.sweepOrientationKind).toBe('path');
    expect(s.editingSweepId).toBeNull();
  });
});

describe('useAppStore activeDocument discriminator', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
  });

  it('activeDocument defaults to null after reset', () => {
    const s = useAppStore.getState();
    expect(s.activeDocument).toBeNull();
  });

  it('setActiveDocument with kind: part keeps activePart shim working', () => {
    const part: PartDocument = { id: 'P1', name: 'p', units: 'mm', parameters: {}, featureTree: [] } as any;
    useAppStore.getState().setActiveDocument({ kind: 'part', document: part });
    const s = useAppStore.getState();
    expect(s.activeDocument).toEqual({ kind: 'part', document: part });
    expect(s.activePart).toEqual(part);
    expect(s.activeAssembly).toBeNull();
  });

  it('setActiveDocument with kind: assembly clears activePart shim', () => {
    const asm: AssemblyDocument = { id: 'A1', name: 'a', units: 'mm', parameters: {}, components: [] };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    const s = useAppStore.getState();
    expect(s.activeDocument).toEqual({ kind: 'assembly', document: asm });
    expect(s.activePart).toBeNull();
    expect(s.activeAssembly).toEqual(asm);
  });

  it('setActivePart legacy setter wraps as part-kinded activeDocument', () => {
    const part: PartDocument = { id: 'P1', name: 'p', units: 'mm', parameters: {}, featureTree: [] } as any;
    useAppStore.getState().setActivePart(part);
    const s = useAppStore.getState();
    expect(s.activeDocument).toEqual({ kind: 'part', document: part });
    expect(s.activePart).toEqual(part);
    expect(s.activeAssembly).toBeNull();
  });
});
