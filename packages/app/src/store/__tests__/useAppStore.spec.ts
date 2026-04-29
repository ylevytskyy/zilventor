import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../useAppStore';
import type { AssemblyDocument, PartDocument, SketchConstraint, SketchPrimitive } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';

const mkPart = (): PartDocument => ({
  id: 'P1',
  name: 'Part1',
  units: 'mm',
  parameters: {},
  featureTree: [
    { kind: 'sketch', id: 'S1', plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [], constraints: [] }
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
      featureTree: [{ kind: 'sketch', id: 'S1', plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [], constraints: [] }]
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
    const asm: AssemblyDocument = { id: 'A1', name: 'a', units: 'mm', parameters: {}, components: [], constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {} };
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

describe('useAppStore assembly dialog + component CRUD slice', () => {
  beforeEach(() => {
    const s = useAppStore.getState();
    s.setActiveDocument(null);
    s.resetPlaceComponentDialog();
    s.resetEditComponentDialog();
    s.selectComponent(null);
    s.setComponentDiagnostics([]);
  });

  it('assembly dialog state defaults are sane', () => {
    const s = useAppStore.getState();
    expect(s.placeComponentDialogOpen).toBe(false);
    expect(s.editComponentDialogOpen).toBe(false);
    expect(s.editingComponentId).toBeNull();
    expect(s.editComponentInitialValues).toBeNull();
    expect(s.selectedComponentPaths).toEqual([]);
    expect(s.componentDiagnostics).toEqual([]);
  });

  it('openPlaceComponentDialog opens it; resetPlaceComponentDialog closes', () => {
    useAppStore.getState().openPlaceComponentDialog();
    expect(useAppStore.getState().placeComponentDialogOpen).toBe(true);
    useAppStore.getState().resetPlaceComponentDialog();
    expect(useAppStore.getState().placeComponentDialogOpen).toBe(false);
  });

  it('addComponent appends to the active assembly', () => {
    const asm: AssemblyDocument = { id: 'A1', name: 'a', units: 'mm', parameters: {}, components: [], constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {} };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    useAppStore.getState().addComponent({
      id: 'C1', partPath: 'leg.zipt',
      position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
    });
    const s = useAppStore.getState();
    expect(s.activeAssembly?.components).toHaveLength(1);
    expect(s.activeAssembly?.components[0]!.id).toBe('C1');
  });

  it('updateComponent patches the named component', () => {
    const asm: AssemblyDocument = {
      id: 'A1', name: 'a', units: 'mm', parameters: {},
      components: [
        { id: 'C1', partPath: 'leg.zipt',
          position: { x: 0, y: 0, z: 0 },
          rotation: { rx: 0, ry: 0, rz: 0 },
          visible: true },
      ],
      constraints: [],
      groundedComponentPaths: [],
      colors: {},
      bomItemNumbers: {}, colorOverrides: {},
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    useAppStore.getState().updateComponent('C1', { position: { x: 50, y: 0, z: 0 } });
    expect(useAppStore.getState().activeAssembly?.components[0]!.position.x).toBe(50);
  });

  it('removeComponent removes by id', () => {
    const asm: AssemblyDocument = {
      id: 'A1', name: 'a', units: 'mm', parameters: {},
      components: [
        { id: 'C1', partPath: 'leg.zipt',
          position: { x: 0, y: 0, z: 0 },
          rotation: { rx: 0, ry: 0, rz: 0 },
          visible: true },
      ],
      constraints: [],
      groundedComponentPaths: [],
      colors: {},
      bomItemNumbers: {}, colorOverrides: {},
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    useAppStore.getState().removeComponent('C1');
    expect(useAppStore.getState().activeAssembly?.components).toHaveLength(0);
  });
});

describe('useAppStore selectedComponentPaths slice (4d)', () => {
  it('selectComponents replaces the selection (one-element paths per id)', () => {
    useAppStore.setState({ selectedComponentPaths: [] } as any);
    useAppStore.getState().selectComponents(['C1', 'C2']);
    expect(useAppStore.getState().selectedComponentPaths).toEqual([['C1'], ['C2']]);
  });

  it('selectComponent shim accepts string | null and writes a one-element path', () => {
    useAppStore.getState().selectComponent('C7');
    expect(useAppStore.getState().selectedComponentPaths).toEqual([['C7']]);
    useAppStore.getState().selectComponent(null);
    expect(useAppStore.getState().selectedComponentPaths).toEqual([]);
  });

  it('selectComponentPaths replaces the array', () => {
    useAppStore.setState({ selectedComponentPaths: [] } as any);
    useAppStore.getState().selectComponentPaths([['drawer', 'screw'], ['leg']]);
    expect(useAppStore.getState().selectedComponentPaths).toEqual([['drawer', 'screw'], ['leg']]);
  });
});

describe('useAppStore subAssembly slices (4d T18)', () => {
  beforeEach(() => {
    useAppStore.setState({
      subAssemblyDocs: {},
      subAssemblyDiagnostics: [],
      expandedSubAsmPaths: new Set<string>(),
    } as any);
  });

  it('useAppStore tracks subAssemblyDocs by partPath', () => {
    const doc: AssemblyDocument = {
      id: 'a-id', name: 'a', units: 'mm', parameters: {},
      components: [], constraints: [], groundedComponentPaths: [],
      colors: {}, bomItemNumbers: {}, colorOverrides: {},
    };
    useAppStore.getState().setSubAssemblyDocs({ 'a.ziasm': doc });
    expect(useAppStore.getState().subAssemblyDocs['a.ziasm']?.id).toBe('a-id');
  });

  it('useAppStore tracks subAssemblyDiagnostics', () => {
    useAppStore.getState().setSubAssemblyDiagnostics([
      { partPath: 'a.ziasm', kind: 'cycle', message: 'x' },
    ]);
    expect(useAppStore.getState().subAssemblyDiagnostics).toHaveLength(1);
    expect(useAppStore.getState().subAssemblyDiagnostics[0]!.kind).toBe('cycle');
  });

  it('toggleSubAsmExpanded toggles a path key', () => {
    const k = pathKey(['drawer']);
    useAppStore.getState().toggleSubAsmExpanded(k);
    expect(useAppStore.getState().expandedSubAsmPaths.has(k)).toBe(true);
    useAppStore.getState().toggleSubAsmExpanded(k);
    expect(useAppStore.getState().expandedSubAsmPaths.has(k)).toBe(false);
  });
});

describe('useAppStore bomTabActive + showComponentColors slices (4c)', () => {
  it('bomTabActive defaults false and setBomTabActive flips it', () => {
    useAppStore.setState({ bomTabActive: false } as any);
    expect(useAppStore.getState().bomTabActive).toBe(false);
    useAppStore.getState().setBomTabActive(true);
    expect(useAppStore.getState().bomTabActive).toBe(true);
  });

  it('showComponentColors defaults false and setShowComponentColors flips it', () => {
    useAppStore.setState({ showComponentColors: false } as any);
    expect(useAppStore.getState().showComponentColors).toBe(false);
    useAppStore.getState().setShowComponentColors(true);
    expect(useAppStore.getState().showComponentColors).toBe(true);
  });
});

describe('useAppStore setComponentColor (4c)', () => {
  it('setComponentColor patches the named component', () => {
    useAppStore.setState({
      activeAssembly: {
        id: 'A', name: 'A', units: 'mm', parameters: {},
        components: [{ id: 'C1', partPath: 'p', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true }],
        constraints: [], groundedComponentPaths: [['C1']],
        colors: {}, bomItemNumbers: {}, colorOverrides: {},
      },
      activeDocument: null,
    } as any);
    useAppStore.getState().setComponentColor('C1', { kind: 'palette', name: 'Maple' });
    expect(useAppStore.getState().activeAssembly!.components[0]!.color).toEqual({ kind: 'palette', name: 'Maple' });

    useAppStore.getState().setComponentColor('C1', undefined);
    expect(useAppStore.getState().activeAssembly!.components[0]!.color).toBeUndefined();
  });
});

describe('useAppStore assembly palette CRUD (4c)', () => {
  it('setAssemblyPaletteColor creates and overwrites entries', () => {
    useAppStore.setState({
      activeAssembly: {
        id: 'A', name: 'A', units: 'mm', parameters: {},
        components: [], constraints: [], groundedComponentPaths: [],
        colors: {}, bomItemNumbers: {}, colorOverrides: {},
      },
    } as any);
    useAppStore.getState().setAssemblyPaletteColor('Maple', '#d4a574');
    expect(useAppStore.getState().activeAssembly!.colors).toEqual({ Maple: '#d4a574' });
    useAppStore.getState().setAssemblyPaletteColor('Maple', '#000000');
    expect(useAppStore.getState().activeAssembly!.colors).toEqual({ Maple: '#000000' });
  });

  it('removeAssemblyPaletteColor drops the named entry', () => {
    useAppStore.setState({
      activeAssembly: {
        id: 'A', name: 'A', units: 'mm', parameters: {},
        components: [], constraints: [], groundedComponentPaths: [],
        colors: { Maple: '#d4a574', Walnut: '#5a3a22' }, bomItemNumbers: {}, colorOverrides: {},
      },
    } as any);
    useAppStore.getState().removeAssemblyPaletteColor('Maple');
    expect(useAppStore.getState().activeAssembly!.colors).toEqual({ Walnut: '#5a3a22' });
  });
});

describe('useAppStore BOM item-number actions (4c)', () => {
  it('setBomItemNumber bumps the colliding row to max+1', () => {
    useAppStore.setState({
      activeAssembly: {
        id: 'A', name: 'A', units: 'mm', parameters: {},
        components: [], constraints: [], groundedComponentPaths: [],
        colors: {}, bomItemNumbers: { rowA: 1, rowB: 2 },
      },
    } as any);
    useAppStore.getState().setBomItemNumber('rowA', 2);
    const map = useAppStore.getState().activeAssembly!.bomItemNumbers;
    expect(map.rowA).toBe(2);
    expect(map.rowB).toBe(3);
  });

  it('setBomItemNumbers bulk-replaces the map', () => {
    useAppStore.setState({
      activeAssembly: {
        id: 'A', name: 'A', units: 'mm', parameters: {},
        components: [], constraints: [], groundedComponentPaths: [],
        colors: {}, bomItemNumbers: { old1: 1, old2: 2 },
      },
    } as any);
    useAppStore.getState().setBomItemNumbers({ rowX: 5 });
    expect(useAppStore.getState().activeAssembly!.bomItemNumbers).toEqual({ rowX: 5 });
  });
});






describe('useAppStore work-feature dialog slices', () => {
  beforeEach(() => {
    useAppStore.getState().resetWorkAxisDialog();
    useAppStore.getState().resetWorkPlaneDialog();
    useAppStore.getState().resetWorkPointDialog();
  });

  it('work-feature dialog defaults are sane', () => {
    const s = useAppStore.getState();
    expect(s.workAxisDialogOpen).toBe(false);
    expect(s.workAxisInitialValues).toBeNull();
    expect(s.editingWorkAxisId).toBeNull();
    expect(s.workPlaneDialogOpen).toBe(false);
    expect(s.workPlaneInitialValues).toBeNull();
    expect(s.editingWorkPlaneId).toBeNull();
    expect(s.workPointDialogOpen).toBe(false);
    expect(s.workPointInitialValues).toBeNull();
    expect(s.editingWorkPointId).toBeNull();
  });

  it('toggleWorkPlaneDialog opens + closes', () => {
    useAppStore.getState().toggleWorkPlaneDialog(true);
    expect(useAppStore.getState().workPlaneDialogOpen).toBe(true);
    useAppStore.getState().toggleWorkPlaneDialog(false);
    expect(useAppStore.getState().workPlaneDialogOpen).toBe(false);
  });

  it('toggleWorkAxisDialog and toggleWorkPointDialog mirror the plane dialog', () => {
    useAppStore.getState().toggleWorkAxisDialog(true);
    useAppStore.getState().toggleWorkPointDialog(true);
    expect(useAppStore.getState().workAxisDialogOpen).toBe(true);
    expect(useAppStore.getState().workPointDialogOpen).toBe(true);
  });

  it('openWorkPlaneForEdit primes initialValues from the active part', () => {
    const wp = { kind: 'workPlane', id: 'WP1', visible: true, source: { mode: 'origin', plane: 'XY' } } as any;
    useAppStore.getState().setActivePart({
      id: 'P1', name: 'p', units: 'mm', parameters: {},
      featureTree: [wp],
    });
    useAppStore.getState().openWorkPlaneForEdit('WP1');
    const s = useAppStore.getState();
    expect(s.workPlaneDialogOpen).toBe(true);
    expect(s.editingWorkPlaneId).toBe('WP1');
    expect(s.workPlaneInitialValues).toEqual(wp);
  });

  it('setWorkFeatureVisible updates a feature without touching others', () => {
    useAppStore.getState().setActivePart({
      id: 'P1', name: 'p', units: 'mm', parameters: {},
      featureTree: [
        { kind: 'workPlane', id: 'origin.XY', visible: false, source: { mode: 'origin', plane: 'XY' } } as any,
        { kind: 'workAxis', id: 'origin.X', visible: false, source: { mode: 'origin', axis: 'X' } } as any,
      ],
    });
    useAppStore.getState().setWorkFeatureVisible('origin.XY', true);
    const tree = useAppStore.getState().activePart!.featureTree;
    expect((tree[0] as any).visible).toBe(true);
    expect((tree[1] as any).visible).toBe(false);
  });
});

describe('useAppStore work-feature pick slice', () => {
  beforeEach(() => {
    useAppStore.getState().clearWorkFeaturePick();
  });

  it('defaults to no pending pick and no pick result', () => {
    const s = useAppStore.getState();
    expect(s.pendingWorkFeaturePick).toBeNull();
    expect(s.workFeaturePickResult).toBeNull();
  });

  it('requestWorkFeaturePick stores the pending request', () => {
    useAppStore.getState().requestWorkFeaturePick({ kind: 'plane', role: 'planeA', mode: 'workPlane' });
    const s = useAppStore.getState();
    expect(s.pendingWorkFeaturePick).toEqual({ kind: 'plane', role: 'planeA', mode: 'workPlane' });
    expect(s.workFeaturePickResult).toBeNull();
  });

  it('setWorkFeaturePickResult populates result and clears the pending request', () => {
    useAppStore.getState().requestWorkFeaturePick({ kind: 'plane', role: 'planeA', mode: 'workPlane' });
    useAppStore.getState().setWorkFeaturePickResult({
      kind: 'plane',
      role: 'planeA',
      hit: { kind: 'workPlane', featureId: 'origin.XY' },
    });
    const s = useAppStore.getState();
    expect(s.pendingWorkFeaturePick).toBeNull();
    expect(s.workFeaturePickResult).toEqual({
      kind: 'plane',
      role: 'planeA',
      hit: { kind: 'workPlane', featureId: 'origin.XY' },
    });
  });

  it('clearWorkFeaturePick wipes both pending and result', () => {
    useAppStore.getState().requestWorkFeaturePick({ kind: 'axis', role: 'axisRef', mode: 'workAxis' });
    useAppStore.getState().setWorkFeaturePickResult({
      kind: 'axis',
      role: 'axisRef',
      hit: { kind: 'workAxis', featureId: 'origin.X' },
    });
    useAppStore.getState().clearWorkFeaturePick();
    const s = useAppStore.getState();
    expect(s.pendingWorkFeaturePick).toBeNull();
    expect(s.workFeaturePickResult).toBeNull();
  });
});

describe('useAppStore 4b extensions', () => {
  beforeEach(() => {
    useAppStore.setState({ solverDirty: false, componentPoses: new Map(), solverDiagnostics: { dofCount: 0, status: 'fully-constrained', perConstraint: new Map() }, freeDofBasis: null });
  });

  it('starts with empty solver state', () => {
    const s = useAppStore.getState();
    expect(s.solverDirty).toBe(false);
    expect(s.componentPoses.size).toBe(0);
    expect(s.solverDiagnostics.dofCount).toBe(0);
    expect(s.freeDofBasis).toBeNull();
  });
  it('addAssemblyConstraint sets solverDirty', () => {
    useAppStore.setState({
      activeDocument: { kind: 'assembly', document: { id: 'A', name: 'a', units: 'mm', parameters: {}, components: [], constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {} } },
      activeAssembly: { id: 'A', name: 'a', units: 'mm', parameters: {}, components: [], constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {} } as any,
    });
    useAppStore.getState().addAssemblyConstraint({ id: 'k1', kind: 'mate', suppressed: false, refA: {} as any, refB: {} as any, offset: { kind: 'literal', value: 0 } } as any);
    expect(useAppStore.getState().solverDirty).toBe(true);
    expect(useAppStore.getState().activeAssembly!.constraints).toHaveLength(1);
  });
  it('toggleGrounded adds/removes ids', () => {
    useAppStore.setState({
      activeAssembly: { id: 'A', name: 'a', units: 'mm', parameters: {}, components: [], constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {} } as any,
      activeDocument: { kind: 'assembly', document: { id: 'A', name: 'a', units: 'mm', parameters: {}, components: [], constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {} } },
    });
    useAppStore.getState().toggleGrounded('C1');
    expect(useAppStore.getState().activeAssembly!.groundedComponentPaths.some((p) => p.length === 1 && p[0] === 'C1')).toBe(true);
    useAppStore.getState().toggleGrounded('C1');
    expect(useAppStore.getState().activeAssembly!.groundedComponentPaths.some((p) => p.length === 1 && p[0] === 'C1')).toBe(false);
  });
});

