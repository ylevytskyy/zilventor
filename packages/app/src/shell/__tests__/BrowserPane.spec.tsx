import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BrowserPane from '../BrowserPane';
import type { PartDocument, AssemblyDocument } from '@zilventor/shared';
import { useAppStore } from '../../store/useAppStore';

describe('BrowserPane', () => {
  beforeEach(() => {
    const s = useAppStore.getState();
    s.setActiveDocument(null);
    s.setActivePart(null);
    s.setFeatureErrors(new Map());
    s.resetWorkAxisDialog();
    s.resetWorkPlaneDialog();
    s.resetWorkPointDialog();
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
      ]
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
      ]
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
      bomItemNumbers: {}, colorOverrides: {},
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
      bomItemNumbers: {}, colorOverrides: {},
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
    });
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
    bomItemNumbers: {}, colorOverrides: {},
  };

  it('assembly mode renders both Assembly/BOM tab strip and the existing tree', () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    render(<BrowserPane part={null} />);
    expect(screen.getByRole('button', { name: /^assembly$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^bom$/i })).toBeInTheDocument();
    expect(screen.getByText(/Assembly: cabinet/)).toBeInTheDocument();
    expect(screen.getByText(/Components/)).toBeInTheDocument();
  });

  it('clicking the BOM tab sets bomTabActive=true and renders BomTable', () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    render(<BrowserPane part={null} partNames={new Map([['parts/leg.zipt', 'leg']])} />);
    fireEvent.click(screen.getByRole('button', { name: /^bom$/i }));
    expect(useAppStore.getState().bomTabActive).toBe(true);
    expect(screen.getByTestId('bom-table')).toBeInTheDocument();
  });

  it('clicking the Assembly tab while BOM is active flips back', () => {
    useAppStore.setState({
      activeDocument: { kind: 'assembly', document: asm },
      activeAssembly: asm,
      bomTabActive: true,
    } as any);
    render(<BrowserPane part={null} partNames={new Map([['parts/leg.zipt', 'leg']])} />);
    fireEvent.click(screen.getByRole('button', { name: /^assembly$/i }));
    expect(useAppStore.getState().bomTabActive).toBe(false);
    expect(screen.queryByTestId('bom-table')).toBeNull();
  });

  it('part mode hides the tab strip', () => {
    const part: PartDocument = {
      id: 'p1', name: 'Part1', units: 'mm', parameters: {}, properties: {},
      featureTree: [],
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
      selectedComponentPaths: [],
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
    colors: {}, bomItemNumbers: {}, colorOverrides: {},
  };

  const topDoc = (subOverrides: Partial<any> = {}): AssemblyDocument => ({
    id: 'A1', name: 'cabinet', units: 'mm', parameters: {}, properties: {},
    components: [
      { id: 'SUB1', partPath: 'sub/drawer.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, ...subOverrides },
    ],
    constraints: [], groundedComponentPaths: [],
    colors: {}, bomItemNumbers: {}, colorOverrides: {},
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
      colors: {}, bomItemNumbers: {}, colorOverrides: {},
    };
    useAppStore.setState({
      activeDocument: { kind: 'assembly', document: { ...topDoc(), components: [{ id: 'TOP', partPath: 'sub/cyclic.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true }] } },
      subAssemblyDocs: { 'sub/cyclic.ziasm': cyclicDoc },
      expandedSubAsmPaths: new Set<string>(['TOP', 'TOP/INNER']),
    } as any);
    expect(() => render(<BrowserPane part={null} />)).not.toThrow();
  });
});
