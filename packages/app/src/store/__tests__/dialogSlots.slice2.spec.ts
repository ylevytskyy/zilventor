import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../useAppStore';

describe('slice-2 dialog store slots', () => {
  beforeEach(() => {
    useAppStore.getState().setAddDoorDialog(null);
    useAppStore.getState().setShelfPinDialog(null);
    useAppStore.getState().setOneComponentPickHandle(null);
  });

  it('addDoorDialog defaults null and round-trips through setter', () => {
    expect(useAppStore.getState().addDoorDialog).toBeNull();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    useAppStore.getState().setAddDoorDialog({ cabinetPath: 'parts/cab.ziasm', onSubmit, onCancel });
    expect(useAppStore.getState().addDoorDialog?.cabinetPath).toBe('parts/cab.ziasm');
    useAppStore.getState().setAddDoorDialog(null);
    expect(useAppStore.getState().addDoorDialog).toBeNull();
  });

  it('shelfPinDialog defaults null and round-trips through setter', () => {
    expect(useAppStore.getState().shelfPinDialog).toBeNull();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    useAppStore.getState().setShelfPinDialog({ mode: 'auto', onSubmit, onCancel });
    expect(useAppStore.getState().shelfPinDialog?.mode).toBe('auto');
    useAppStore.getState().setShelfPinDialog({ mode: 'manual', panelPath: 'parts/side.zipt', face: 'Top', onSubmit, onCancel });
    expect(useAppStore.getState().shelfPinDialog?.mode).toBe('manual');
    useAppStore.getState().setShelfPinDialog(null);
    expect(useAppStore.getState().shelfPinDialog).toBeNull();
  });

  it('oneComponentPickHandle defaults null and stores a handle object', () => {
    expect(useAppStore.getState().oneComponentPickHandle).toBeNull();
    const handle = { pick: vi.fn(), reset: vi.fn() };
    useAppStore.getState().setOneComponentPickHandle(handle);
    expect(useAppStore.getState().oneComponentPickHandle).toBe(handle);
    useAppStore.getState().setOneComponentPickHandle(null);
    expect(useAppStore.getState().oneComponentPickHandle).toBeNull();
  });
});
