import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../useAppStore';
import type { ComponentPath } from '@zilventor/shared';

describe('useAppStore — groove selection (P9 W1)', () => {
  beforeEach(() => {
    useAppStore.getState().setSelectedGroove(null, null);
    useAppStore.getState().setSelectedBore(null, null);
    useAppStore.getState().selectComponentPaths([]);
  });

  it('initial selectedGrooveId and selectedGroovePartPath are null', () => {
    const s = useAppStore.getState();
    expect(s.selectedGrooveId).toBeNull();
    expect(s.selectedGroovePartPath).toBeNull();
  });

  it('setSelectedGroove sets grooveId and partPath', () => {
    useAppStore.getState().setSelectedGroove('groove-1', 'parts/side.zipt');
    const s = useAppStore.getState();
    expect(s.selectedGrooveId).toBe('groove-1');
    expect(s.selectedGroovePartPath).toBe('parts/side.zipt');
  });

  it('setSelectedGroove(null, null) clears selection', () => {
    useAppStore.getState().setSelectedGroove('groove-1', 'parts/side.zipt');
    useAppStore.getState().setSelectedGroove(null, null);
    const s = useAppStore.getState();
    expect(s.selectedGrooveId).toBeNull();
    expect(s.selectedGroovePartPath).toBeNull();
  });

  it('setSelectedGroove clears selectedComponentPaths and selectedBoreId (mutual exclusion)', () => {
    const path: ComponentPath = ['c1'];
    useAppStore.getState().selectComponentPaths([path]);
    useAppStore.getState().setSelectedBore('bore-1', 'parts/side.zipt');
    useAppStore.getState().setSelectedGroove('groove-1', 'parts/side.zipt');
    const s = useAppStore.getState();
    expect(s.selectedComponentPaths).toHaveLength(0);
    expect(s.selectedBoreId).toBeNull();
    expect(s.selectedBorePartPath).toBeNull();
  });

  it('setSelectedBore clears selectedGrooveId and selectedGroovePartPath (mutual exclusion)', () => {
    useAppStore.getState().setSelectedGroove('groove-1', 'parts/side.zipt');
    useAppStore.getState().setSelectedBore('bore-1', 'parts/side.zipt');
    const s = useAppStore.getState();
    expect(s.selectedGrooveId).toBeNull();
    expect(s.selectedGroovePartPath).toBeNull();
  });

  it('selectComponentPaths clears selectedGrooveId and selectedGroovePartPath (mutual exclusion)', () => {
    useAppStore.getState().setSelectedGroove('groove-1', 'parts/side.zipt');
    const path: ComponentPath = ['c1'];
    useAppStore.getState().selectComponentPaths([path]);
    const s = useAppStore.getState();
    expect(s.selectedGrooveId).toBeNull();
    expect(s.selectedGroovePartPath).toBeNull();
  });
});
