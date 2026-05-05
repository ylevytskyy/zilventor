import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useToolModeStore } from '../toolMode';
import type { ToolMode, PendingViewParams, SectionToolState, DetailToolState } from '../toolMode';

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

describe('detail tool — initial state + mode discriminant', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
  });

  it('reset() initialises detailState to { stage: "idle" }', () => {
    const s = useToolModeStore.getState();
    expect(s.detailState).toEqual({ stage: 'idle' });
  });

  it('setMode("detail") sets mode=detail without touching detailState', () => {
    useToolModeStore.getState().setMode('detail');
    const s = useToolModeStore.getState();
    expect(s.mode).toBe('detail');
    expect(s.detailState).toEqual({ stage: 'idle' });
  });

  it('enterDetailMode() sets mode=detail, stage=idle', () => {
    useToolModeStore.getState().enterDetailMode();
    const s = useToolModeStore.getState();
    expect(s.mode).toBe('detail');
    expect(s.detailState).toEqual({ stage: 'idle' });
  });

  it('setMode round-trip list now includes detail', () => {
    useToolModeStore.getState().setMode('detail');
    expect(useToolModeStore.getState().mode).toBe('detail');
  });

  it('reset() from detail mode returns to idle and clears detailState', () => {
    useToolModeStore.getState().enterDetailMode();
    useToolModeStore.getState().reset();
    expect(useToolModeStore.getState().mode).toBe('idle');
    expect(useToolModeStore.getState().detailState).toEqual({ stage: 'idle' });
  });
});

describe('detail tool — stage transitions', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterDetailMode();
  });

  it('detailPickParent() from idle → pickRegionCenter with parentViewId', () => {
    useToolModeStore.getState().detailPickParent('v-base-1');
    const s = useToolModeStore.getState();
    expect(s.detailState).toEqual({ stage: 'pickRegionCenter', parentViewId: 'v-base-1' });
  });

  it('detailPickParent() from non-idle stage is a no-op + warns', () => {
    useToolModeStore.getState().detailPickParent('v1');
    // now stage = pickRegionCenter; calling again should warn and not advance
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useToolModeStore.getState().detailPickParent('v2');
    expect(useToolModeStore.getState().detailState).toMatchObject({ stage: 'pickRegionCenter', parentViewId: 'v1' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('detailPickCenter() from pickRegionCenter → pickRegionRadius with center', () => {
    useToolModeStore.getState().detailPickParent('v1');
    useToolModeStore.getState().detailPickCenter({ x: 10, y: 8 });
    const s = useToolModeStore.getState();
    expect(s.detailState).toEqual({
      stage: 'pickRegionRadius',
      parentViewId: 'v1',
      center: { x: 10, y: 8 },
    });
  });

  it('detailPickCenter() from wrong stage is a no-op + warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // stage is still idle (no prior detailPickParent in this sub-test)
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterDetailMode();
    useToolModeStore.getState().detailPickCenter({ x: 5, y: 5 });
    expect(useToolModeStore.getState().detailState).toEqual({ stage: 'idle' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('detailPickRadius() from pickRegionRadius → pickDrop with radiusMm = distance to center', () => {
    useToolModeStore.getState().detailPickParent('v1');
    useToolModeStore.getState().detailPickCenter({ x: 10, y: 8 });
    // Click at (25, 8): distance from (10,8) = 15mm
    useToolModeStore.getState().detailPickRadius({ x: 25, y: 8 });
    const s = useToolModeStore.getState();
    expect(s.detailState).toMatchObject({
      stage: 'pickDrop',
      parentViewId: 'v1',
      center: { x: 10, y: 8 },
    });
    const ds = s.detailState as { stage: 'pickDrop'; radiusMm: number };
    expect(ds.radiusMm).toBeCloseTo(15, 3);
  });

  it('detailPickRadius() with non-zero y component computes correct Euclidean distance', () => {
    useToolModeStore.getState().detailPickParent('v1');
    useToolModeStore.getState().detailPickCenter({ x: 0, y: 0 });
    // Click at (3, 4): distance = 5
    useToolModeStore.getState().detailPickRadius({ x: 3, y: 4 });
    const ds = useToolModeStore.getState().detailState as { stage: 'pickDrop'; radiusMm: number };
    expect(ds.radiusMm).toBeCloseTo(5, 3);
  });

  it('detailPickDrop() calls onDispatch callback and resets stage to idle', () => {
    useToolModeStore.getState().detailPickParent('v1');
    useToolModeStore.getState().detailPickCenter({ x: 10, y: 8 });
    useToolModeStore.getState().detailPickRadius({ x: 25, y: 8 });
    const onDispatch = vi.fn();
    useToolModeStore.getState().detailPickDrop({ x: 200, y: 150 }, onDispatch);
    expect(onDispatch).toHaveBeenCalledOnce();
    expect(useToolModeStore.getState().detailState).toEqual({ stage: 'idle' });
    expect(useToolModeStore.getState().mode).toBe('idle');
  });

  it('detailPickDrop() from wrong stage is a no-op + warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cb = vi.fn();
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterDetailMode();
    useToolModeStore.getState().detailPickDrop({ x: 5, y: 5 }, cb);
    expect(cb).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
