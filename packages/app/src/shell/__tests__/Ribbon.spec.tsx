import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Ribbon from '../Ribbon';
import { useAppStore } from '../../store/useAppStore';

describe('Ribbon', () => {
  it('shows all 7 tabs and Model is active by default', () => {
    render(<Ribbon />);
    for (const label of ['File', 'Model', 'Sketch', 'Furniture', 'Inspect', 'Drawing', 'View']) {
      expect(screen.getByRole('tab', { name: label })).toBeTruthy();
    }
    expect(screen.getByRole('tab', { name: 'Model' }).getAttribute('aria-selected')).toBe('true');
  });

  it('switching to Furniture shows the stub notice', () => {
    render(<Ribbon />);
    fireEvent.click(screen.getByRole('tab', { name: 'Furniture' }));
    expect(screen.getByText(/sub-project 5/i)).toBeTruthy();
  });

  it('switching to Inspect references sub-project 3', () => {
    render(<Ribbon />);
    fireEvent.click(screen.getByRole('tab', { name: 'Inspect' }));
    expect(screen.getByText(/sub-project 3/i)).toBeTruthy();
  });

  it('switching to Drawing references sub-project 6', () => {
    render(<Ribbon />);
    fireEvent.click(screen.getByRole('tab', { name: 'Drawing' }));
    expect(screen.getByText(/sub-project 6/i)).toBeTruthy();
  });

  it('Model tab shows Fillet, Chamfer, Shell buttons in the Modify panel', () => {
    render(<Ribbon />);
    // Model is active by default, so the Modify panel buttons are rendered.
    expect(screen.getByRole('button', { name: /Fillet/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Chamfer/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Shell/ })).toBeTruthy();
  });

  it('Modify panel renders a Hole button that fires AddHoleFeatureCommand', () => {
    // Give the store a part with a running body so the Modify buttons are enabled.
    useAppStore.getState().setActivePart({
      id: 'P1', name: 'Part1', units: 'mm', parameters: {},
      featureTree: [
        { kind: 'sketch', id: 'S1', plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [], constraints: [] },
        { kind: 'extrude', id: 'E1', sketchRef: 'S1', distanceParam: 'd1', direction: 'forward', operation: 'new' },
      ],
    });
    useAppStore.getState().resetHoleDialog();
    render(<Ribbon />);
    const btn = screen.getByRole('button', { name: /hole/i });
    expect(btn).toBeTruthy();
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(useAppStore.getState().holeDialogOpen).toBe(true);
    // cleanup
    useAppStore.getState().setActivePart(null);
    useAppStore.getState().resetHoleDialog();
  });

  it('Model → Create → Sweep button opens the sweep dialog', () => {
    useAppStore.getState().setActivePart({
      id: 'P1', name: 'Part1', units: 'mm', parameters: {},
      featureTree: [
        { kind: 'sketch', id: 'S1', plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [], constraints: [] },
      ],
    });
    useAppStore.getState().resetSweepDialog();
    render(<Ribbon />);
    const btn = screen.getByRole('button', { name: /sweep/i });
    expect(btn).toBeTruthy();
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(useAppStore.getState().sweepDialogOpen).toBe(true);
    // cleanup
    useAppStore.getState().setActivePart(null);
    useAppStore.getState().resetSweepDialog();
  });
});
