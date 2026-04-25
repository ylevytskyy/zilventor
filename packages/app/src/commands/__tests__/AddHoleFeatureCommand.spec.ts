import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { AddHoleFeatureCommand } from '../AddHoleFeatureCommand';

describe('AddHoleFeatureCommand', () => {
  beforeEach(() => {
    useAppStore.getState().resetHoleDialog();
  });

  it('opens the hole dialog and clears any prior dialog state', () => {
    // Pre-condition: simulate stale dialog state
    useAppStore.setState({ holeSketchId: 'STALE', editingHoleId: 'STALE' });

    AddHoleFeatureCommand();

    const s = useAppStore.getState();
    expect(s.holeDialogOpen).toBe(true);
    expect(s.holeSketchId).toBeNull();
    expect(s.editingHoleId).toBeNull();
  });
});
