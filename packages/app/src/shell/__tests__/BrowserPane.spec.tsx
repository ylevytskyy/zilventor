import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BrowserPane from '../BrowserPane';
import type { PartDocument, AssemblyDocument } from '@zilventor/shared';
import { useAppStore } from '../../store/useAppStore';

describe('BrowserPane', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  it('shows the empty state when no part is loaded', () => {
    render(<BrowserPane part={null} />);
    expect(screen.getByText(/no part open/i)).toBeTruthy();
  });

  it('lists features (Sketch1, Extrusion1, End of Part) when a part is loaded', () => {
    const part: PartDocument = {
      id: 'p1', name: 'Part1', units: 'mm', parameters: {},
      featureTree: [
        { kind: 'sketch', id: 's1', plane: 'XY', primitives: [], constraints: [] },
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
        { kind: 'sketch', id: 's1', plane: 'XY', primitives: [], constraints: [] },
        { kind: 'sketch', id: 's2', plane: 'XY', primitives: [], constraints: [] },
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
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    render(<BrowserPane part={null} />);
    fireEvent.doubleClick(screen.getByText(/leg/));
    expect(useAppStore.getState().editComponentDialogOpen).toBe(true);
    expect(useAppStore.getState().editingComponentId).toBe('C1');
  });
});
