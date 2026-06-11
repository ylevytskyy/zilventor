import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../useAppStore';
import type { ComponentPath } from '@zilventor/shared';

describe('useAppStore — bore selection (slice-3)', () => {
  beforeEach(() => {
    // Reset bore + component selection to clean state.
    useAppStore.getState().setSelectedBore(null, null);
    useAppStore.getState().selectComponentPaths([]);
  });

  it('initial selectedBoreId and selectedBorePartPath are null', () => {
    const s = useAppStore.getState();
    expect(s.selectedBoreId).toBeNull();
    expect(s.selectedBorePartPath).toBeNull();
  });

  it('setSelectedBore sets boreId and partPath', () => {
    useAppStore.getState().setSelectedBore('bore-1', 'parts/side.zipt');
    const s = useAppStore.getState();
    expect(s.selectedBoreId).toBe('bore-1');
    expect(s.selectedBorePartPath).toBe('parts/side.zipt');
  });

  it('setSelectedBore(null, null) clears selection', () => {
    useAppStore.getState().setSelectedBore('bore-1', 'parts/side.zipt');
    useAppStore.getState().setSelectedBore(null, null);
    const s = useAppStore.getState();
    expect(s.selectedBoreId).toBeNull();
    expect(s.selectedBorePartPath).toBeNull();
  });

  it('setSelectedBore clears selectedComponentPaths (mutual exclusion)', () => {
    const path: ComponentPath = ['c1'];
    useAppStore.getState().selectComponentPaths([path]);
    expect(useAppStore.getState().selectedComponentPaths).toHaveLength(1);
    useAppStore.getState().setSelectedBore('bore-1', 'parts/side.zipt');
    expect(useAppStore.getState().selectedComponentPaths).toHaveLength(0);
  });

  it('selectComponentPaths clears selectedBoreId and selectedBorePartPath (mutual exclusion)', () => {
    useAppStore.getState().setSelectedBore('bore-1', 'parts/side.zipt');
    const path: ComponentPath = ['c1'];
    useAppStore.getState().selectComponentPaths([path]);
    const s = useAppStore.getState();
    expect(s.selectedBoreId).toBeNull();
    expect(s.selectedBorePartPath).toBeNull();
  });
});
