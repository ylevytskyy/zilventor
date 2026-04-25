import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { OpenSweepDialogCommand } from '../OpenSweepDialogCommand';

describe('OpenSweepDialogCommand', () => {
  beforeEach(() => {
    useAppStore.getState().resetSweepDialog();
  });

  it('opens dialog and clears stale state', () => {
    useAppStore.setState({ sweepProfileSketchId: 'STALE', editingSweepId: 'STALE' } as any);
    OpenSweepDialogCommand();
    const s = useAppStore.getState();
    expect(s.sweepDialogOpen).toBe(true);
    expect(s.sweepProfileSketchId).toBeNull();
    expect(s.editingSweepId).toBeNull();
  });
});
