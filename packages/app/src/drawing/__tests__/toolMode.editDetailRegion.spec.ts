import { describe, it, expect, beforeEach } from 'vitest';
import { useToolModeStore } from '../toolMode';
import type { EditDetailRegionToolState } from '../toolMode';
import { MIN_DETAIL_RADIUS_MM } from '../drawingConstants';

describe('MIN_DETAIL_RADIUS_MM constant', () => {
  it('is 1.0', () => {
    expect(MIN_DETAIL_RADIUS_MM).toBe(1.0);
  });
});

describe('editDetailRegion ToolMode — initial state', () => {
  beforeEach(() => { useToolModeStore.getState().reset(); });

  it('default editDetailRegionState is { stage: "idle" }', () => {
    const s = useToolModeStore.getState();
    expect(s.editDetailRegionState).toEqual({ stage: 'idle' });
  });

  it('reset() restores editDetailRegionState to { stage: "idle" }', () => {
    useToolModeStore.getState().enterEditDetailRegionMode();
    useToolModeStore.getState().reset();
    expect(useToolModeStore.getState().editDetailRegionState).toEqual({ stage: 'idle' });
    expect(useToolModeStore.getState().mode).toBe('idle');
  });

  it('enterEditDetailRegionMode() → mode = "editDetailRegion", state = { stage: "idle" }', () => {
    useToolModeStore.getState().enterEditDetailRegionMode();
    const s = useToolModeStore.getState();
    expect(s.mode).toBe('editDetailRegion');
    expect(s.editDetailRegionState).toEqual({ stage: 'idle' });
  });
});
