import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../useAppStore';
import type { ComponentPath } from '@zilventor/shared';

describe('useAppStore — keyholeSlot selection (P17 W1)', () => {
  beforeEach(() => {
    useAppStore.getState().setSelectedKeyholeSlot(null, null);
    useAppStore.getState().setSelectedGroove(null, null);
    useAppStore.getState().setSelectedBore(null, null);
    useAppStore.getState().selectComponentPaths([]);
  });

  it('initial selectedKeyholeSlotId and selectedKeyholeSlotPartPath are null', () => {
    const s = useAppStore.getState();
    expect(s.selectedKeyholeSlotId).toBeNull();
    expect(s.selectedKeyholeSlotPartPath).toBeNull();
  });

  it('setSelectedKeyholeSlot sets keyholeSlotId and partPath', () => {
    useAppStore.getState().setSelectedKeyholeSlot('keyholeSlot-1', 'parts/side.zipt');
    const s = useAppStore.getState();
    expect(s.selectedKeyholeSlotId).toBe('keyholeSlot-1');
    expect(s.selectedKeyholeSlotPartPath).toBe('parts/side.zipt');
  });

  it('setSelectedKeyholeSlot(null, null) clears selection', () => {
    useAppStore.getState().setSelectedKeyholeSlot('keyholeSlot-1', 'parts/side.zipt');
    useAppStore.getState().setSelectedKeyholeSlot(null, null);
    const s = useAppStore.getState();
    expect(s.selectedKeyholeSlotId).toBeNull();
    expect(s.selectedKeyholeSlotPartPath).toBeNull();
  });

  it('setSelectedKeyholeSlot clears selectedComponentPaths, selectedBoreId and selectedGrooveId (mutual exclusion)', () => {
    const path: ComponentPath = ['c1'];
    useAppStore.getState().selectComponentPaths([path]);
    useAppStore.getState().setSelectedBore('bore-1', 'parts/side.zipt');
    useAppStore.getState().setSelectedGroove('groove-1', 'parts/side.zipt');
    useAppStore.getState().setSelectedKeyholeSlot('keyholeSlot-1', 'parts/side.zipt');
    const s = useAppStore.getState();
    expect(s.selectedComponentPaths).toHaveLength(0);
    expect(s.selectedBoreId).toBeNull();
    expect(s.selectedBorePartPath).toBeNull();
    expect(s.selectedGrooveId).toBeNull();
    expect(s.selectedGroovePartPath).toBeNull();
  });

  it('setSelectedBore clears selectedKeyholeSlotId and selectedKeyholeSlotPartPath (mutual exclusion)', () => {
    useAppStore.getState().setSelectedKeyholeSlot('keyholeSlot-1', 'parts/side.zipt');
    useAppStore.getState().setSelectedBore('bore-1', 'parts/side.zipt');
    const s = useAppStore.getState();
    expect(s.selectedKeyholeSlotId).toBeNull();
    expect(s.selectedKeyholeSlotPartPath).toBeNull();
  });

  it('selectComponentPaths clears selectedKeyholeSlotId and selectedKeyholeSlotPartPath (mutual exclusion)', () => {
    useAppStore.getState().setSelectedKeyholeSlot('keyholeSlot-1', 'parts/side.zipt');
    const path: ComponentPath = ['c1'];
    useAppStore.getState().selectComponentPaths([path]);
    const s = useAppStore.getState();
    expect(s.selectedKeyholeSlotId).toBeNull();
    expect(s.selectedKeyholeSlotPartPath).toBeNull();
  });

  it('setSelectedGroove clears selectedKeyholeSlotId and selectedKeyholeSlotPartPath (mutual exclusion)', () => {
    useAppStore.getState().setSelectedKeyholeSlot('keyholeSlot-1', 'parts/side.zipt');
    useAppStore.getState().setSelectedGroove('groove-1', 'parts/side.zipt');
    const s = useAppStore.getState();
    expect(s.selectedKeyholeSlotId).toBeNull();
    expect(s.selectedKeyholeSlotPartPath).toBeNull();
  });
});
