import { describe, it, expect, beforeEach } from 'vitest';
import { useToolModeStore } from '../toolMode';
import type { ToolMode, PendingViewParams } from '../toolMode';

describe('useToolModeStore', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
  });

  it('default state: mode=idle, pendingViewParams=null', () => {
    const s = useToolModeStore.getState();
    expect(s.mode).toBe('idle');
    expect(s.pendingViewParams).toBeNull();
  });

  it('setMode round-trip for every ToolMode value', () => {
    const modes: ToolMode[] = [
      'idle',
      'placeBase', 'placeProjected', 'placeIso',
      'addLinearH', 'addLinearV', 'addAligned', 'addRadial', 'addDiametric',
      'addCenterline', 'addCenterMark', 'addLeader', 'addBalloon',
    ];
    for (const mode of modes) {
      useToolModeStore.getState().setMode(mode);
      expect(useToolModeStore.getState().mode).toBe(mode);
    }
  });

  it('reset() sets mode back to idle', () => {
    useToolModeStore.getState().setMode('addRadial');
    expect(useToolModeStore.getState().mode).toBe('addRadial');
    useToolModeStore.getState().reset();
    expect(useToolModeStore.getState().mode).toBe('idle');
  });

  it('reset() clears pendingViewParams', () => {
    const params: PendingViewParams = {
      kind: 'base',
      orientation: 'front',
      scale: { n: 1, d: 1 },
    };
    useToolModeStore.getState().setPendingViewParams(params);
    expect(useToolModeStore.getState().pendingViewParams).toEqual(params);
    useToolModeStore.getState().reset();
    expect(useToolModeStore.getState().pendingViewParams).toBeNull();
  });

  it('setPendingViewParams round-trip for base variant', () => {
    const params: PendingViewParams = {
      kind: 'base',
      orientation: 'top',
      scale: { n: 1, d: 2 },
    };
    useToolModeStore.getState().setPendingViewParams(params);
    expect(useToolModeStore.getState().pendingViewParams).toEqual(params);
  });

  it('setPendingViewParams round-trip for projected variant', () => {
    const params: PendingViewParams = {
      kind: 'projected',
      baseViewId: 'bv-abc',
      direction: 'left',
    };
    useToolModeStore.getState().setPendingViewParams(params);
    expect(useToolModeStore.getState().pendingViewParams).toEqual(params);
  });

  it('setPendingViewParams round-trip for iso variant', () => {
    const params: PendingViewParams = {
      kind: 'iso',
      corner: 'SW',
      scale: { n: 1, d: 5 },
    };
    useToolModeStore.getState().setPendingViewParams(params);
    expect(useToolModeStore.getState().pendingViewParams).toEqual(params);
  });

  it('setPendingViewParams(null) clears params', () => {
    useToolModeStore.getState().setPendingViewParams({
      kind: 'iso', corner: 'NE', scale: { n: 1, d: 1 },
    });
    useToolModeStore.getState().setPendingViewParams(null);
    expect(useToolModeStore.getState().pendingViewParams).toBeNull();
  });

  it('setMode does not clear pendingViewParams', () => {
    const params: PendingViewParams = { kind: 'base', orientation: 'front', scale: { n: 1, d: 1 } };
    useToolModeStore.getState().setPendingViewParams(params);
    useToolModeStore.getState().setMode('addLinearH');
    expect(useToolModeStore.getState().pendingViewParams).toEqual(params);
  });
});
