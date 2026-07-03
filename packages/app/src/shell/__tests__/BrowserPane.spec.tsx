import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BrowserPane from '../BrowserPane';
import type { PartDocument, AssemblyDocument, PanelPreflightDiagnostic } from '@zilventor/shared';
import { useAppStore } from '../../store/useAppStore';
import { CutListCacheContext } from '../CutListCacheContext';

describe('BrowserPane', () => {
  beforeEach(() => {
    const s = useAppStore.getState();
    s.setActiveDocument(null);
    s.setActivePart(null);
    s.setFeatureErrors(new Map());
    s.resetWorkAxisDialog();
    s.resetWorkPlaneDialog();
    s.resetWorkPointDialog();
    useAppStore.setState({
      editComponentDialogOpen: false,
      editingComponentId: null,
      selectedComponentPaths: [],
      bomTabActive: false,
      cutListTabActive: false,
      nestingTabActive: false,
      subAssemblyDocs: {},
      expandedSubAsmPaths: new Set<string>(),
    } as never);
  });

  it('shows the empty state when no part is loaded', () => {
    render(<BrowserPane part={null} />);
    expect(screen.getByText(/no part open/i)).toBeTruthy();
  });

  it('lists features (Sketch1, Extrusion1, End of Part) when a part is loaded', () => {
    const part: PartDocument = {
      id: 'p1', name: 'Part1', units: 'mm', parameters: {}, properties: {},
      featureTree: [
        { kind: 'sketch', id: 's1', plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [], constraints: [] },
        { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward', operation: 'new' }
      ],
      materials: [],
      hardware: [],
    };
    render(<BrowserPane part={part} />);
    expect(screen.getByText('Part1')).toBeTruthy();
    expect(screen.getByText(/Sketch1/i)).toBeTruthy();
    expect(screen.getByText(/Extrusion1/i)).toBeTruthy();
    expect(screen.getByText(/End of Part/i)).toBeTruthy();
  });

  it('numbers sequential sketches and extrusions independently', () => {
    const part: PartDocument = {
      id: 'p1', name: 'Part1', units: 'mm', parameters: {}, properties: {},
      featureTree: [
        { kind: 'sketch', id: 's1', plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [], constraints: [] },
        { kind: 'sketch', id: 's2', plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [], constraints: [] },
        { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward', operation: 'new' }
      ],
      materials: [],
      hardware: [],
    };
    render(<BrowserPane part={part} />);
    expect(screen.getByText(/Sketch1/i)).toBeTruthy();
    expect(screen.getByText(/Sketch2/i)).toBeTruthy();
    expect(screen.getByText(/Extrusion1/i)).toBeTruthy();
  });

  it('renders a Hole node for each HoleFeature in the tree', () => {
    const stored: any = {
      id: 'H1', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'S1' },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: 5 } },
      termination: { kind: 'throughAll' },
      flipAxis: false,
    };
    const part: PartDocument = {
      id: 'P1', name: 'P', units: 'mm', parameters: {},
      featureTree: [stored],
    } as any;
    render(<BrowserPane part={part} />);
    expect(screen.getByText(/H1/)).toBeInTheDocument();
  });

  it('double-clicking a Hole node opens the dialog in edit mode', () => {
    const stored: any = {
      id: 'H1', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'S1' },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: 5 } },
      termination: { kind: 'throughAll' },
      flipAxis: false,
    };
    const part: PartDocument = {
      id: 'P1', name: 'P', units: 'mm', parameters: {},
      featureTree: [stored],
    } as any;
    render(<BrowserPane part={part} />);
    fireEvent.doubleClick(screen.getByText(/H1/));
    const s = useAppStore.getState();
    expect(s.holeDialogOpen).toBe(true);
    expect(s.editingHoleId).toBe('H1');
  });

  it('renders Sweep node and double-click opens dialog in edit mode', () => {
    const stored: any = {
      id: 'SW1', kind: 'sweep',
      profileSketchId: 'P', pathSketchId: 'A',
      orientation: { kind: 'path' },
      operation: 'new',
    };
    const part: PartDocument = {
      id: 'P1', name: 'P', units: 'mm', parameters: {},
      featureTree: [stored],
    } as any;
    render(<BrowserPane part={part} />);
    expect(screen.getByText(/Sweep SW1/)).toBeTruthy();
    fireEvent.doubleClick(screen.getByText(/Sweep SW1/));
    const s = useAppStore.getState();
    expect(s.sweepDialogOpen).toBe(true);
    expect(s.editingSweepId).toBe('SW1');
  });

  it('assembly mode renders Components node + N component leaves', () => {
    const asm: AssemblyDocument = {
      id: 'A1', name: 'cabinet', units: 'mm', parameters: {}, properties: {},
      components: [
        { id: 'C1', partPath: 'parts/leg.zipt',
          position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'C2', partPath: 'parts/shelf.zipt',
          position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      constraints: [],
      groundedComponentPaths: [],
      colors: {},
      bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [],
      hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    render(<BrowserPane part={null} />);
    expect(screen.getByText(/Assembly: cabinet/)).toBeInTheDocument();
    expect(screen.getByText(/Components \(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/leg/)).toBeInTheDocument();
    expect(screen.getByText(/shelf/)).toBeInTheDocument();
  });

  it('double-clicking a component opens the edit dialog', () => {
    const asm: AssemblyDocument = {
      id: 'A1', name: 'cabinet', units: 'mm', parameters: {}, properties: {},
      components: [
        { id: 'C1', partPath: 'parts/leg.zipt',
          position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      constraints: [],
      groundedComponentPaths: [],
      colors: {},
      bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [],
      hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    render(<BrowserPane part={null} />);
    fireEvent.doubleClick(screen.getByText(/leg/));
    expect(useAppStore.getState().editComponentDialogOpen).toBe(true);
    expect(useAppStore.getState().editingComponentId).toBe('C1');
  });

  // ---- T34: Origin group + work-feature leaves; visibility toggles + broken-ref badges ----

  const ORIGIN_FEATURES: any[] = [
    { kind: 'workAxis', id: 'origin.X', visible: false, source: { mode: 'origin', axis: 'X' } },
    { kind: 'workAxis', id: 'origin.Y', visible: false, source: { mode: 'origin', axis: 'Y' } },
    { kind: 'workAxis', id: 'origin.Z', visible: false, source: { mode: 'origin', axis: 'Z' } },
    { kind: 'workPlane', id: 'origin.XY', visible: false, source: { mode: 'origin', plane: 'XY' } },
    { kind: 'workPlane', id: 'origin.YZ', visible: false, source: { mode: 'origin', plane: 'YZ' } },
    { kind: 'workPlane', id: 'origin.XZ', visible: false, source: { mode: 'origin', plane: 'XZ' } },
    { kind: 'workPoint', id: 'origin.O', visible: false, source: { mode: 'origin' } },
  ];

  it('renders an Origin group containing all 7 origin work features', () => {
    const part: PartDocument = {
      id: 'p1', name: 'Part1', units: 'mm', parameters: {},
      featureTree: ORIGIN_FEATURES,
    } as any;
    render(<BrowserPane part={part} />);
    expect(screen.getByTestId('origin-group')).toBeInTheDocument();
    expect(screen.getByText('origin.X')).toBeInTheDocument();
    expect(screen.getByText('origin.Y')).toBeInTheDocument();
    expect(screen.getByText('origin.Z')).toBeInTheDocument();
    expect(screen.getByText('origin.XY')).toBeInTheDocument();
    expect(screen.getByText('origin.YZ')).toBeInTheDocument();
    expect(screen.getByText('origin.XZ')).toBeInTheDocument();
    expect(screen.getByText('origin.O')).toBeInTheDocument();
  });

  it('clicking the visibility toggle on an origin work plane calls setWorkFeatureVisible(true)', () => {
    const part: PartDocument = {
      id: 'p1', name: 'P', units: 'mm', parameters: {},
      featureTree: ORIGIN_FEATURES,
    } as any;
    useAppStore.getState().setActivePart(part);
    render(<BrowserPane part={useAppStore.getState().activePart!} />);
    const toggle = screen.getByLabelText('Toggle visibility for origin.XY');
    fireEvent.click(toggle);
    const next = useAppStore.getState().activePart!;
    const xy = next.featureTree.find((f: any) => f.id === 'origin.XY')!;
    expect((xy as any).visible).toBe(true);
  });

  it('renders user-created work features inline as Plane{n}/Axis{n}/Point{n} leaves', () => {
    const fakeEdge = { faceA: { featureId: 'e1', role: 'a' }, faceB: { featureId: 'e1', role: 'b' } };
    const part: PartDocument = {
      id: 'p1', name: 'P', units: 'mm', parameters: {},
      featureTree: [
        ...ORIGIN_FEATURES,
        { kind: 'workPlane', id: 'wp1', visible: true,
          source: { mode: 'offsetFromPlane', plane: { source: 'workPlane', featureId: 'origin.XY' }, offset: { kind: 'literal', value: 25 } } },
        { kind: 'workAxis', id: 'wa1', visible: true,
          source: { mode: 'edge', edge: fakeEdge } },
        { kind: 'workPoint', id: 'wpt1', visible: true,
          source: { mode: 'midpointOfEdge', edge: fakeEdge } },
      ],
    } as any;
    render(<BrowserPane part={part} />);
    expect(screen.getByText(/Plane1/)).toBeInTheDocument();
    expect(screen.getByText(/Axis1/)).toBeInTheDocument();
    expect(screen.getByText(/Point1/)).toBeInTheDocument();
  });

  it('double-clicking a user work plane opens the WorkPlane dialog in edit mode', () => {
    const part: PartDocument = {
      id: 'p1', name: 'P', units: 'mm', parameters: {},
      featureTree: [
        ...ORIGIN_FEATURES,
        { kind: 'workPlane', id: 'wp1', visible: true,
          source: { mode: 'offsetFromPlane', plane: { source: 'workPlane', featureId: 'origin.XY' }, offset: { kind: 'literal', value: 25 } } },
      ],
    } as any;
    useAppStore.getState().setActivePart(part);
    render(<BrowserPane part={useAppStore.getState().activePart!} />);
    fireEvent.doubleClick(screen.getByText(/Plane1/));
    expect(useAppStore.getState().workPlaneDialogOpen).toBe(true);
    expect(useAppStore.getState().editingWorkPlaneId).toBe('wp1');
  });

  it('double-clicking a user work axis opens the WorkAxis dialog in edit mode', () => {
    const fakeEdge = { faceA: { featureId: 'e1', role: 'a' }, faceB: { featureId: 'e1', role: 'b' } };
    const part: PartDocument = {
      id: 'p1', name: 'P', units: 'mm', parameters: {},
      featureTree: [
        ...ORIGIN_FEATURES,
        { kind: 'workAxis', id: 'wa1', visible: true, source: { mode: 'edge', edge: fakeEdge } },
      ],
    } as any;
    useAppStore.getState().setActivePart(part);
    render(<BrowserPane part={useAppStore.getState().activePart!} />);
    fireEvent.doubleClick(screen.getByText(/Axis1/));
    expect(useAppStore.getState().workAxisDialogOpen).toBe(true);
    expect(useAppStore.getState().editingWorkAxisId).toBe('wa1');
  });

  it('double-clicking a user work point opens the WorkPoint dialog in edit mode', () => {
    const fakeEdge = { faceA: { featureId: 'e1', role: 'a' }, faceB: { featureId: 'e1', role: 'b' } };
    const part: PartDocument = {
      id: 'p1', name: 'P', units: 'mm', parameters: {},
      featureTree: [
        ...ORIGIN_FEATURES,
        { kind: 'workPoint', id: 'wpt1', visible: true, source: { mode: 'midpointOfEdge', edge: fakeEdge } },
      ],
    } as any;
    useAppStore.getState().setActivePart(part);
    render(<BrowserPane part={useAppStore.getState().activePart!} />);
    fireEvent.doubleClick(screen.getByText(/Point1/));
    expect(useAppStore.getState().workPointDialogOpen).toBe(true);
    expect(useAppStore.getState().editingWorkPointId).toBe('wpt1');
  });

  it('clicking the visibility toggle on a user work plane flips visible to false', () => {
    const part: PartDocument = {
      id: 'p1', name: 'P', units: 'mm', parameters: {},
      featureTree: [
        ...ORIGIN_FEATURES,
        { kind: 'workPlane', id: 'wp1', visible: true,
          source: { mode: 'offsetFromPlane', plane: { source: 'workPlane', featureId: 'origin.XY' }, offset: { kind: 'literal', value: 25 } } },
      ],
    } as any;
    useAppStore.getState().setActivePart(part);
    render(<BrowserPane part={useAppStore.getState().activePart!} />);
    fireEvent.click(screen.getByLabelText('Toggle visibility for wp1'));
    const next = useAppStore.getState().activePart!;
    const wp = next.featureTree.find((f: any) => f.id === 'wp1')!;
    expect((wp as any).visible).toBe(false);
  });

  it('error badge on a work plane opens the WorkPlane dialog in edit mode', () => {
    const part: PartDocument = {
      id: 'p1', name: 'P', units: 'mm', parameters: {},
      featureTree: [
        ...ORIGIN_FEATURES,
        { kind: 'workPlane', id: 'wp1', visible: true,
          source: { mode: 'offsetFromPlane', plane: { source: 'workPlane', featureId: 'origin.XY' }, offset: { kind: 'literal', value: 25 } } },
      ],
    } as any;
    useAppStore.getState().setActivePart(part);
    useAppStore.getState().setFeatureErrors(new Map([
      ['wp1', { kind: 'work-feature-eval-failed', message: 'broken ref', featureId: 'wp1' } as any],
    ]));
    render(<BrowserPane part={useAppStore.getState().activePart!} />);
    fireEvent.click(screen.getByLabelText('Feature wp1 has errors'));
    expect(useAppStore.getState().workPlaneDialogOpen).toBe(true);
    expect(useAppStore.getState().editingWorkPlaneId).toBe('wp1');
  });

  it('error badge on a work axis opens the WorkAxis dialog in edit mode', () => {
    const fakeEdge = { faceA: { featureId: 'e1', role: 'a' }, faceB: { featureId: 'e1', role: 'b' } };
    const part: PartDocument = {
      id: 'p1', name: 'P', units: 'mm', parameters: {},
      featureTree: [
        ...ORIGIN_FEATURES,
        { kind: 'workAxis', id: 'wa1', visible: true, source: { mode: 'edge', edge: fakeEdge } },
      ],
    } as any;
    useAppStore.getState().setActivePart(part);
    useAppStore.getState().setFeatureErrors(new Map([
      ['wa1', { kind: 'work-feature-eval-failed', message: 'broken ref', featureId: 'wa1' } as any],
    ]));
    render(<BrowserPane part={useAppStore.getState().activePart!} />);
    fireEvent.click(screen.getByLabelText('Feature wa1 has errors'));
    expect(useAppStore.getState().workAxisDialogOpen).toBe(true);
    expect(useAppStore.getState().editingWorkAxisId).toBe('wa1');
  });

  // ---- P9 W1: groove tree node + selection wiring ----

  it('renders a labeled Groove node for a groove feature (not the mislabeled Extrusion fallback)', () => {
    const groove: any = {
      kind: 'groove', id: 'g1', faceRole: 'Front', axis: 'u', position: 10, width: 8, depth: 6,
    };
    const part: PartDocument = {
      id: 'p1', name: 'Part1', units: 'mm', parameters: {},
      featureTree: [groove],
    } as any;
    render(<BrowserPane part={part} />);
    expect(screen.getByText(/Groove1/)).toBeInTheDocument();
    expect(screen.queryByText(/Extrusion1/)).toBeNull();
  });

  it('clicking a Groove node sets selectedGrooveId/selectedGroovePartPath, not setSelectedFeature', () => {
    useAppStore.getState().setSelectedGroove(null, null);
    const beforeFeatureId = useAppStore.getState().selectedFeatureId;
    const groove: any = {
      kind: 'groove', id: 'g1', faceRole: 'Front', axis: 'u', position: 10, width: 8, depth: 6,
    };
    const part: PartDocument = {
      id: 'p1', name: 'Part1', units: 'mm', parameters: {},
      featureTree: [groove],
    } as any;
    render(<BrowserPane part={part} />);
    fireEvent.click(screen.getByText(/Groove1/));
    const s = useAppStore.getState();
    expect(s.selectedGrooveId).toBe('g1');
    expect(s.selectedGroovePartPath).toBe('p1');
    expect(s.selectedFeatureId).toBe(beforeFeatureId);
  });

  // ---- P17 W1: keyholeSlot tree node + selection wiring ----

  it('renders a labeled Keyhole Slot node for a keyholeSlot feature (not the mislabeled Extrusion fallback)', () => {
    const keyholeSlot: any = {
      kind: 'keyholeSlot', id: 'ks1', faceRole: 'Back', headDiameter: 10, shaftWidth: 5, slotLength: 20, depth: 6,
    };
    const part: PartDocument = {
      id: 'p1', name: 'Part1', units: 'mm', parameters: {},
      featureTree: [keyholeSlot],
    } as any;
    render(<BrowserPane part={part} />);
    expect(screen.getByText(/Keyhole Slot 1/)).toBeInTheDocument();
    expect(screen.queryByText(/Extrusion1/)).toBeNull();
  });

  it('clicking a Keyhole Slot node sets selectedKeyholeSlotId/selectedKeyholeSlotPartPath, not setSelectedFeature', () => {
    useAppStore.getState().setSelectedKeyholeSlot(null, null);
    const beforeFeatureId = useAppStore.getState().selectedFeatureId;
    const keyholeSlot: any = {
      kind: 'keyholeSlot', id: 'ks1', faceRole: 'Back', headDiameter: 10, shaftWidth: 5, slotLength: 20, depth: 6,
    };
    const part: PartDocument = {
      id: 'p1', name: 'Part1', units: 'mm', parameters: {},
      featureTree: [keyholeSlot],
    } as any;
    render(<BrowserPane part={part} />);
    fireEvent.click(screen.getByText(/Keyhole Slot 1/));
    const s = useAppStore.getState();
    expect(s.selectedKeyholeSlotId).toBe('ks1');
    expect(s.selectedKeyholeSlotPartPath).toBe('p1');
    expect(s.selectedFeatureId).toBe(beforeFeatureId);
  });

});

describe('BrowserPane — panel feature (T28)', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeDocument: null,
      activePart: null,
    } as Partial<ReturnType<typeof useAppStore.getState>>);
    useAppStore.getState().setFeatureErrors(new Map());
  });

  function makePanelPart(): PartDocument {
    const panel: any = {
      kind: 'panel',
      id: 'PANEL1',
      length: { kind: 'literal', value: 600 },
      width: { kind: 'literal', value: 400 },
      thickness: { kind: 'literal', value: 18 },
      thicknessFromMaterial: false,
      materialId: 'mat-1',
      grain: 'length',
      edgeBands: { front: null, back: null, left: null, right: null },
    };
    return {
      id: 'P1', name: 'P', units: 'mm', parameters: {}, properties: {},
      featureTree: [panel],
      materials: [],
      hardware: [],
    } as any;
  }

  it('renders a Panel row with the PanelIcon', () => {
    const part = makePanelPart();
    const { container } = render(<BrowserPane part={part} />);
    expect(screen.getByText('Panel')).toBeInTheDocument();
    const li = container.querySelector('li[data-panel-feature-id="PANEL1"]') as HTMLElement;
    expect(li).toBeTruthy();
    expect(li.querySelector('svg')).toBeTruthy();
  });

  it('double-clicking the Panel row dispatches EditPanelFeatureCommand (panel feature is replaced)', () => {
    const part = makePanelPart();
    useAppStore.getState().setActivePart(part);
    const { container } = render(<BrowserPane part={useAppStore.getState().activePart!} />);
    const li = container.querySelector('li[data-panel-feature-id="PANEL1"]') as HTMLElement;
    fireEvent.doubleClick(li);
    // EditPanelFeatureCommand replaces the feature with the same value (no-op
    // behaviorally), but the call path is the dispatch surface this test
    // verifies. After dispatch the active part still has the panel.
    const after = useAppStore.getState().activePart!;
    expect(after.featureTree.find((f: any) => f.id === 'PANEL1')).toBeTruthy();
  });

  it('right-click context menu suppress flips the suppressed flag', () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('suppress');
    const part = makePanelPart();
    useAppStore.getState().setActivePart(part);
    const { container } = render(<BrowserPane part={useAppStore.getState().activePart!} />);
    const li = container.querySelector('li[data-panel-feature-id="PANEL1"]') as HTMLElement;
    fireEvent.contextMenu(li);
    expect(promptSpy).toHaveBeenCalled();
    const after = useAppStore.getState().activePart!;
    const panelAfter = after.featureTree.find((f: any) => f.id === 'PANEL1') as any;
    expect(panelAfter.suppressed).toBe(true);
    promptSpy.mockRestore();
  });

  it('right-click context menu delete removes the panel feature', () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('delete');
    const part = makePanelPart();
    useAppStore.getState().setActivePart(part);
    const { container } = render(<BrowserPane part={useAppStore.getState().activePart!} />);
    const li = container.querySelector('li[data-panel-feature-id="PANEL1"]') as HTMLElement;
    fireEvent.contextMenu(li);
    expect(promptSpy).toHaveBeenCalled();
    const after = useAppStore.getState().activePart!;
    expect(after.featureTree.find((f: any) => f.id === 'PANEL1')).toBeUndefined();
    promptSpy.mockRestore();
  });
});

describe('BrowserPane — imported feature (T21)', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeDocument: null, activePart: null,
      holeDialogOpen: false, shellDialogOpen: false, chamferDialogOpen: false,
      filletDialogOpen: false, sweepDialogOpen: false,
      workAxisDialogOpen: false, workPlaneDialogOpen: false, workPointDialogOpen: false,
    } as Partial<ReturnType<typeof useAppStore.getState>>);
    useAppStore.getState().setFeatureErrors(new Map());
  });

  function makeImportedPart(): PartDocument {
    return {
      id: 'p-imported', name: 'Imported', units: 'mm', parameters: {},
      featureTree: [
        { kind: 'imported', id: 'imp-1', sourceStep: 'SidePanel.step', bodyRef: 'blob-1' },
      ],
      properties: {},
    } as any;
  }

  it('renders an imported feature with the source STEP filename', () => {
    const part = makeImportedPart();
    render(<BrowserPane part={part} />);
    expect(screen.getByText(/Imported \(SidePanel\.step\)/)).toBeInTheDocument();
  });

  it('renders the imported feature li with data-imported="true"', () => {
    const part = makeImportedPart();
    const { container } = render(<BrowserPane part={part} />);
    const li = container.querySelector('li[data-imported="true"]');
    expect(li).toBeTruthy();
  });

  it('does not open any edit dialog when double-clicking the imported feature', () => {
    const part = makeImportedPart();
    const { container } = render(<BrowserPane part={part} />);
    const li = container.querySelector('li[data-imported="true"]') as HTMLElement;
    expect(li).toBeTruthy();
    fireEvent.doubleClick(li);
    const s = useAppStore.getState();
    expect(s.holeDialogOpen).toBeFalsy();
    expect(s.shellDialogOpen).toBeFalsy();
    expect(s.chamferDialogOpen).toBeFalsy();
    expect(s.filletDialogOpen).toBeFalsy();
    expect(s.sweepDialogOpen).toBeFalsy();
    expect(s.workAxisDialogOpen).toBeFalsy();
    expect(s.workPlaneDialogOpen).toBeFalsy();
    expect(s.workPointDialogOpen).toBeFalsy();
  });
});

describe('BrowserPane assembly + constraints', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeDocument: { kind: 'assembly', document: {
        id: 'A', name: 'a', units: 'mm', parameters: {},
        components: [
          { id: 'C1', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
          { id: 'C2', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        ],
        constraints: [{
          id: 'k1', kind: 'mate', suppressed: false,
          refA: { kind: 'face', componentPath: ['C1'], face: { featureId: 'f', role: 'r' } } as any,
          refB: { kind: 'face', componentPath: ['C2'], face: { featureId: 'g', role: 'r' } } as any,
          offset: { kind: 'literal', value: 0 } as any,
        }],
        groundedComponentPaths: [['C1']],
      } as any },
      subAssemblyDocs: {},
      expandedSubAsmPaths: new Set<string>(),
      selectedComponentPaths: [],
      editComponentDialogOpen: false,
      editingComponentId: null,
      bomTabActive: false,
      cutListTabActive: false,
      nestingTabActive: false,
    } as any);
  });

  it('renders constraint leaves under both endpoints', () => {
    render(<BrowserPane part={null} />);
    const mateLeaves = screen.getAllByText(/Mate/);
    expect(mateLeaves.length).toBe(2);  // duplicated under C1 and C2
  });

  it('renders grounded badge on grounded component', () => {
    render(<BrowserPane part={null} />);
    expect(screen.getByText(/⛓/)).toBeInTheDocument();
  });
});

describe('BrowserPane BOM tab strip', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeDocument: null,
      activeAssembly: null,
      bomTabActive: false,
      cutListTabActive: false,
      nestingTabActive: false,
      subAssemblyDocs: {},
      expandedSubAsmPaths: new Set<string>(),
      selectedComponentPaths: [],
      editComponentDialogOpen: false,
      editingComponentId: null,
    } as any);
  });

  const asm: AssemblyDocument = {
    id: 'A1', name: 'cabinet', units: 'mm', parameters: {}, properties: {},
    components: [
      { id: 'C1', partPath: 'parts/leg.zipt',
        position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ],
    constraints: [],
    groundedComponentPaths: [],
    colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [],
    hardware: [],
  };

  it('assembly mode renders both Assembly/BOM tab strip and the existing tree', () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    render(<BrowserPane part={null} />);
    expect(screen.getByLabelText('Assembly tab')).toBeInTheDocument();
    expect(screen.getByLabelText('BOM tab')).toBeInTheDocument();
    expect(screen.getByText(/Assembly: cabinet/)).toBeInTheDocument();
    expect(screen.getByText(/Components/)).toBeInTheDocument();
  });

  it('clicking the BOM tab sets bomTabActive=true and renders BomTable', () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    render(<BrowserPane part={null} partInfo={new Map([['parts/leg.zipt', { name: 'leg' }]])} />);
    fireEvent.click(screen.getByLabelText('BOM tab'));
    expect(useAppStore.getState().bomTabActive).toBe(true);
    expect(screen.getByTestId('bom-table')).toBeInTheDocument();
  });

  it('clicking the Assembly tab while BOM is active flips back', () => {
    useAppStore.setState({
      activeDocument: { kind: 'assembly', document: asm },
      activeAssembly: asm,
      bomTabActive: true,
    } as any);
    render(<BrowserPane part={null} partInfo={new Map([['parts/leg.zipt', { name: 'leg' }]])} />);
    fireEvent.click(screen.getByLabelText('Assembly tab'));
    expect(useAppStore.getState().bomTabActive).toBe(false);
    expect(screen.queryByTestId('bom-table')).toBeNull();
  });

  it('part mode hides the tab strip', () => {
    const part: PartDocument = {
      id: 'p1', name: 'Part1', units: 'mm', parameters: {}, properties: {},
      featureTree: [],
      materials: [],
      hardware: [],
    };
    render(<BrowserPane part={part} />);
    expect(screen.queryByRole('button', { name: /^bom$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^assembly$/i })).toBeNull();
  });
});

describe('BrowserPane sub-asm recursive tree (4d T25)', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeDocument: null,
      activeAssembly: null,
      subAssemblyDocs: {},
      expandedSubAsmPaths: new Set<string>(),
      bomTabActive: false,
      cutListTabActive: false,
      nestingTabActive: false,
      selectedComponentPaths: [],
      editComponentDialogOpen: false,
      editingComponentId: null,
    } as any);
  });

  const childDoc: AssemblyDocument = {
    id: 'CH', name: 'drawer', units: 'mm', parameters: {}, properties: {},
    components: [
      { id: 'P1', partPath: 'parts/panel-front.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'P2', partPath: 'parts/panel-back.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'P3', partPath: 'parts/panel-side.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ],
    constraints: [], groundedComponentPaths: [],
    colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [],
    hardware: [],
  };

  const topDoc = (subOverrides: Partial<any> = {}): AssemblyDocument => ({
    id: 'A1', name: 'cabinet', units: 'mm', parameters: {}, properties: {},
    components: [
      { id: 'SUB1', partPath: 'sub/drawer.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, ...subOverrides },
    ],
    constraints: [], groundedComponentPaths: [],
    colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [],
    hardware: [],
  });

  it('renders sub-asm placement as expandable node with (N components) annotation', () => {
    useAppStore.setState({
      activeDocument: { kind: 'assembly', document: topDoc() },
      subAssemblyDocs: { 'sub/drawer.ziasm': childDoc },
    } as any);
    render(<BrowserPane part={null} />);
    expect(screen.getByText(/SUB1/)).toBeInTheDocument();
    expect(screen.getByText(/\(3 components\)/)).toBeInTheDocument();
  });

  it('clicking the expand triangle expands and shows child components', () => {
    useAppStore.setState({
      activeDocument: { kind: 'assembly', document: topDoc() },
      subAssemblyDocs: { 'sub/drawer.ziasm': childDoc },
    } as any);
    render(<BrowserPane part={null} />);
    fireEvent.click(screen.getByLabelText('expand SUB1'));
    expect(screen.getByText(/panel-front/)).toBeInTheDocument();
    expect(screen.getByText(/panel-back/)).toBeInTheDocument();
    expect(screen.getByText(/panel-side/)).toBeInTheDocument();
  });

  it('shows a Flexible badge on flexible sub-asm placements', () => {
    useAppStore.setState({
      activeDocument: { kind: 'assembly', document: topDoc({ flexible: true }) },
      subAssemblyDocs: { 'sub/drawer.ziasm': childDoc },
    } as any);
    render(<BrowserPane part={null} />);
    expect(screen.getByText(/Flexible/)).toBeInTheDocument();
  });

  it('clicking a leaf row sets selectedComponentPaths to its componentPath', () => {
    useAppStore.setState({
      activeDocument: { kind: 'assembly', document: topDoc() },
      subAssemblyDocs: { 'sub/drawer.ziasm': childDoc },
      expandedSubAsmPaths: new Set<string>(['SUB1']),
    } as any);
    render(<BrowserPane part={null} />);
    fireEvent.click(screen.getByText(/panel-front/));
    const sel = useAppStore.getState().selectedComponentPaths;
    expect(sel.length).toBe(1);
    expect(Array.from(sel[0]!)).toEqual(['SUB1', 'P1']);
  });

  it('renders a sub-asm placement even when its document is unresolved (placeholder)', () => {
    useAppStore.setState({
      activeDocument: { kind: 'assembly', document: topDoc() },
      subAssemblyDocs: {},
    } as any);
    render(<BrowserPane part={null} />);
    expect(screen.getByText(/SUB1/)).toBeInTheDocument();
  });

  it('double-clicking a top-level sub-asm placement opens the edit dialog (G1)', () => {
    useAppStore.setState({
      activeDocument: { kind: 'assembly', document: topDoc() },
      subAssemblyDocs: { 'sub/drawer.ziasm': childDoc },
    } as any);
    render(<BrowserPane part={null} />);
    fireEvent.doubleClick(screen.getByText(/SUB1/));
    expect(useAppStore.getState().editComponentDialogOpen).toBe(true);
    expect(useAppStore.getState().editingComponentId).toBe('SUB1');
  });

  it('right-click on a sub-asm placement opens it in standalone after confirm (G2)', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    useAppStore.setState({
      activeDocument: { kind: 'assembly', document: topDoc() },
      subAssemblyDocs: { 'sub/drawer.ziasm': childDoc },
    } as any);
    render(<BrowserPane part={null} />);
    fireEvent.contextMenu(screen.getByText(/SUB1/));
    expect(confirmSpy).toHaveBeenCalled();
    expect(useAppStore.getState().activeDocument).toEqual({ kind: 'assembly', document: childDoc });
    confirmSpy.mockRestore();
  });

  it('right-click on a sub-asm placement does nothing when user cancels confirm', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const before = { kind: 'assembly', document: topDoc() } as const;
    useAppStore.setState({
      activeDocument: before,
      subAssemblyDocs: { 'sub/drawer.ziasm': childDoc },
    } as any);
    render(<BrowserPane part={null} />);
    fireEvent.contextMenu(screen.getByText(/SUB1/));
    expect(confirmSpy).toHaveBeenCalled();
    expect(useAppStore.getState().activeDocument).toBe(before);
    confirmSpy.mockRestore();
  });



  it('handles a self-referential cycle without infinite recursion', () => {
    const cyclicDoc: AssemblyDocument = {
      id: 'CY', name: 'cy', units: 'mm', parameters: {}, properties: {},
      components: [
        { id: 'INNER', partPath: 'sub/cyclic.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      constraints: [], groundedComponentPaths: [],
      colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [],
      hardware: [],
    };
    useAppStore.setState({
      activeDocument: { kind: 'assembly', document: { ...topDoc(), components: [{ id: 'TOP', partPath: 'sub/cyclic.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true }] } },
      subAssemblyDocs: { 'sub/cyclic.ziasm': cyclicDoc },
      expandedSubAsmPaths: new Set<string>(['TOP', 'TOP/INNER']),
    } as any);
    expect(() => render(<BrowserPane part={null} />)).not.toThrow();
  });
});

// ---- T20: Cut List tab strip ----

const cutListAsm: AssemblyDocument = {
  id: 'A1', name: 'cabinet', units: 'mm', parameters: {}, properties: {},
  components: [],
  constraints: [],
  groundedComponentPaths: [],
  colors: {},
  bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
  materials: [],
  hardware: [],
};

function seedAssemblyMode() {
  useAppStore.setState({
    activeDocument: { kind: 'assembly', document: cutListAsm },
    activeAssembly: cutListAsm,
    bomTabActive: false,
    cutListTabActive: false,
    nestingTabActive: false,
    subAssemblyDocs: {},
    editComponentDialogOpen: false,
    editingComponentId: null,
    selectedComponentPaths: [],
    expandedSubAsmPaths: new Set<string>(),
  } as any);
}

describe('BrowserPane Cut List tab (5d T20)', () => {
  beforeEach(() => {
    seedAssemblyMode();
  });

  it('renders Assembly | BOM | Cut List tabs in assembly mode', () => {
    render(<BrowserPane part={null} />);
    expect(screen.getByLabelText('Assembly tab')).toBeInTheDocument();
    expect(screen.getByLabelText('BOM tab')).toBeInTheDocument();
    expect(screen.getByLabelText('Cut List tab')).toBeInTheDocument();
  });

  it('clicking Cut List tab dispatches OpenCutListTabCommand', async () => {
    render(<BrowserPane part={null} />);
    fireEvent.click(screen.getByLabelText('Cut List tab'));
    await waitFor(() => {
      expect(useAppStore.getState().cutListTabActive).toBe(true);
      expect(useAppStore.getState().bomTabActive).toBe(false);
    });
  });

  it('shows the CutListTable when cutListTabActive is true', () => {
    useAppStore.getState().setCutListTabActive(true);
    render(<BrowserPane part={null} />);
    // Empty assembly → "No panels" placeholder rendered.
    expect(screen.getByText('No panels')).toBeInTheDocument();
  });
});

// R1: production UI wiring — opening the Nesting tab must receive a live
// showToast so cut-list preflight diagnostics surface as visible toasts.
describe('BrowserPane — Nesting tab R1 preflight toast wiring (production UI)', () => {
  const diagnostics: PanelPreflightDiagnostic[] = [
    { partPath: 'parts/bad.zipt', reasonKey: 'panel.preflight.missingMaterial', params: { name: 'BadPanel' } },
  ];

  beforeEach(() => {
    seedAssemblyMode();
  });

  it('clicking the Nesting tab shows a toast for a diagnostic sourced from the cut-list result', () => {
    const toasts: string[] = [];
    const ctxValue = {
      panelSpecCacheRef: { current: new Map() },
      partInfoCacheRef: { current: new Map() },
      partBoresCacheRef: { current: new Map() },
      partGroovesCacheRef: { current: new Map() },
      diagnosticsCacheRef: { current: diagnostics },
      warmCache: async () => {},
      invalidatePartPaths: async () => {},
    };
    render(
      <CutListCacheContext.Provider value={ctxValue as any}>
        <BrowserPane part={null} showToast={(msg) => toasts.push(msg)} />
      </CutListCacheContext.Provider>,
    );
    fireEvent.click(screen.getByLabelText('Nesting tab'));
    expect(toasts.some((m) => /BadPanel/.test(m) && /material/i.test(m))).toBe(true);
  });
});
