import { describe, it, expect } from 'vitest';
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
      id: 'p1', name: 'Part1', units: 'mm', parameters: {},
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
      id: 'p1', name: 'Part1', units: 'mm', parameters: {},
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
      id: 'A1', name: 'cabinet', units: 'mm', parameters: {},
      components: [
        { id: 'C1', partPath: 'parts/leg.zipt',
          position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'C2', partPath: 'parts/shelf.zipt',
          position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      constraints: [],
      groundedComponentIds: [],
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
      id: 'A1', name: 'cabinet', units: 'mm', parameters: {},
      components: [
        { id: 'C1', partPath: 'parts/leg.zipt',
          position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      constraints: [],
      groundedComponentIds: [],
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
