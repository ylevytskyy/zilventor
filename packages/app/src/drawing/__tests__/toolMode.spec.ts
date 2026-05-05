import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useToolModeStore } from '../toolMode';
import type { ToolMode, PendingViewParams, SectionToolState } from '../toolMode';

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

describe('section tool state machine', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
  });

  it('enterSectionMode() sets mode=section, stage=idle', () => {
    useToolModeStore.getState().enterSectionMode();
    const s = useToolModeStore.getState();
    expect(s.mode).toBe('section');
    expect(s.sectionState).toEqual({ stage: 'idle' });
  });

  it('sectionPickParent() from idle → pickP0 with parentViewId', () => {
    useToolModeStore.getState().enterSectionMode();
    useToolModeStore.getState().sectionPickParent('v1');
    const s = useToolModeStore.getState();
    expect(s.sectionState).toEqual({ stage: 'pickP0', parentViewId: 'v1' });
  });

  it('sectionPickP0() from pickP0 → pickP1 with p0', () => {
    useToolModeStore.getState().enterSectionMode();
    useToolModeStore.getState().sectionPickParent('v1');
    useToolModeStore.getState().sectionPickP0({ x: 10, y: 50 });
    const s = useToolModeStore.getState();
    expect(s.sectionState).toEqual({
      stage: 'pickP1',
      parentViewId: 'v1',
      p0: { x: 10, y: 50 },
    });
  });

  it('sectionPickP1() from pickP1 → pickDrop with default arrowDirection=1', () => {
    useToolModeStore.getState().enterSectionMode();
    useToolModeStore.getState().sectionPickParent('v1');
    useToolModeStore.getState().sectionPickP0({ x: 10, y: 50 });
    useToolModeStore.getState().sectionPickP1({ x: 190, y: 50 });
    const s = useToolModeStore.getState();
    expect(s.sectionState).toEqual({
      stage: 'pickDrop',
      parentViewId: 'v1',
      p0: { x: 10, y: 50 },
      p1: { x: 190, y: 50 },
      arrowDirection: 1,
    });
  });

  it('sectionCancel() from any sub-state → idle', () => {
    useToolModeStore.getState().enterSectionMode();
    useToolModeStore.getState().sectionPickParent('v1');
    useToolModeStore.getState().sectionPickP0({ x: 10, y: 50 });
    useToolModeStore.getState().sectionCancel();
    const s = useToolModeStore.getState();
    expect(s.sectionState).toEqual({ stage: 'idle' });
  });

  it('sectionCancel() twice → mode resets to select', () => {
    useToolModeStore.getState().enterSectionMode();
    useToolModeStore.getState().sectionCancel(); // first ESC: back to idle
    useToolModeStore.getState().sectionCancel(); // second ESC: exit section mode
    expect(useToolModeStore.getState().mode).toBe('idle');
  });

  it('invalid transition: sectionPickP0 from idle is a no-op + warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useToolModeStore.getState().enterSectionMode();
    // stage is 'idle', not 'pickP0' — calling sectionPickP0 should no-op
    useToolModeStore.getState().sectionPickP0({ x: 5, y: 5 });
    expect(useToolModeStore.getState().sectionState).toEqual({ stage: 'idle' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('invalid transition: sectionPickP1 from idle is a no-op + warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useToolModeStore.getState().enterSectionMode();
    useToolModeStore.getState().sectionPickP1({ x: 5, y: 5 });
    expect(useToolModeStore.getState().sectionState).toEqual({ stage: 'idle' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('reset() clears sectionState back to idle', () => {
    useToolModeStore.getState().enterSectionMode();
    useToolModeStore.getState().sectionPickParent('v1');
    useToolModeStore.getState().reset();
    expect(useToolModeStore.getState().sectionState).toEqual({ stage: 'idle' });
    expect(useToolModeStore.getState().mode).toBe('idle');
  });

  it('setMode round-trip includes section', () => {
    useToolModeStore.getState().setMode('section');
    expect(useToolModeStore.getState().mode).toBe('section');
  });
});
