import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BrowserPane from '../BrowserPane';
import type { PartDocument } from '@zilventor/shared';
import { useAppStore } from '../../store/useAppStore';

describe('BrowserPane', () => {
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
});
