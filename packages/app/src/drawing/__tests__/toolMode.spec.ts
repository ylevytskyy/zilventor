import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useToolModeStore } from '../toolMode';
import type { ToolMode, PendingViewParams, SectionToolState, DetailToolState, BreakToolState } from '../toolMode';

describe('useToolModeStore', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
  });

  it('default state: mode=idle, pendingViewParams=null', () => {
    const s = useToolModeStore.getState();
    expect(s.mode).toBe('idle');
    expect(s.pendingViewParams).toBeNull();
  });

  it('setMode round-trip includes break', () => {
    useToolModeStore.getState().setMode('break');
    expect(useToolModeStore.getState().mode).toBe('break');
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

describe('break tool — initial state + BreakToolState type', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
  });

  it('reset() initialises breakState to { stage: "idle" }', () => {
    const s = useToolModeStore.getState();
    expect(s.breakState).toEqual({ stage: 'idle' });
  });

  it('setMode("break") sets mode=break without touching breakState', () => {
    useToolModeStore.getState().setMode('break');
    const s = useToolModeStore.getState();
    expect(s.mode).toBe('break');
    expect(s.breakState).toEqual({ stage: 'idle' });
  });

  it('BreakToolState stage "idle" is the narrow type at runtime', () => {
    useToolModeStore.getState().reset();
    const s = useToolModeStore.getState();
    // Compile-time narrowing: stage === 'idle' has no extra fields
    if (s.breakState.stage === 'idle') {
      // TypeScript should accept this without 'viewId' being accessible
      const keys = Object.keys(s.breakState);
      expect(keys).toEqual(['stage']);
    }
  });
});

describe('break tool — enterBreakMode', () => {
  beforeEach(() => { useToolModeStore.getState().reset(); });

  it('enterBreakMode() sets mode=break, breakState.stage=pickParent', () => {
    useToolModeStore.getState().enterBreakMode();
    const s = useToolModeStore.getState();
    expect(s.mode).toBe('break');
    expect(s.breakState).toEqual({ stage: 'pickParent' });
  });

  it('reset() from break mode clears back to idle', () => {
    useToolModeStore.getState().enterBreakMode();
    useToolModeStore.getState().reset();
    expect(useToolModeStore.getState().mode).toBe('idle');
    expect(useToolModeStore.getState().breakState).toEqual({ stage: 'idle' });
  });
});

describe('break tool — breakPickParent', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterBreakMode();
  });

  it('breakPickParent() from pickParent → pickAxis with viewId', () => {
    useToolModeStore.getState().breakPickParent('bv1');
    const s = useToolModeStore.getState();
    expect(s.breakState).toEqual({ stage: 'pickAxis', viewId: 'bv1' });
  });

  it('breakPickParent() from wrong stage is no-op + warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useToolModeStore.getState().breakPickParent('bv1'); // idle→pickParent done by enterBreakMode; now stage=pickParent
    // now stage=pickAxis; calling again should warn
    useToolModeStore.getState().breakPickParent('bv2');
    expect(useToolModeStore.getState().breakState).toMatchObject({ stage: 'pickAxis', viewId: 'bv1' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('break tool — breakSetAxis', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterBreakMode();
    useToolModeStore.getState().breakPickParent('bv1');
  });

  it('breakSetAxis("x") from pickAxis → pickP0 with axis=x', () => {
    useToolModeStore.getState().breakSetAxis('x');
    expect(useToolModeStore.getState().breakState).toEqual({
      stage: 'pickP0', viewId: 'bv1', axis: 'x',
    });
  });

  it('breakSetAxis("y") from pickAxis → pickP0 with axis=y', () => {
    useToolModeStore.getState().breakSetAxis('y');
    expect(useToolModeStore.getState().breakState).toEqual({
      stage: 'pickP0', viewId: 'bv1', axis: 'y',
    });
  });

  it('breakSetAxis from wrong stage is no-op + warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterBreakMode(); // stage=pickParent
    useToolModeStore.getState().breakSetAxis('x'); // wrong stage
    expect(useToolModeStore.getState().breakState).toEqual({ stage: 'pickParent' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('break tool — breakPickP0', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterBreakMode();
    useToolModeStore.getState().breakPickParent('bv1');
    useToolModeStore.getState().breakSetAxis('x');
  });

  it('breakPickP0() from pickP0 → pickP1 with coordA captured', () => {
    useToolModeStore.getState().breakPickP0(75.5);
    const s = useToolModeStore.getState();
    expect(s.breakState).toEqual({
      stage: 'pickP1', viewId: 'bv1', axis: 'x', coordA: 75.5,
    });
  });

  it('breakPickP0() from wrong stage is no-op + warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterBreakMode(); // stage=pickParent
    useToolModeStore.getState().breakPickP0(50); // wrong stage
    expect(useToolModeStore.getState().breakState).toEqual({ stage: 'pickParent' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('break tool — breakPickP1', () => {
  function setupToPickP1() {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterBreakMode();
    useToolModeStore.getState().breakPickParent('bv1');
    useToolModeStore.getState().breakSetAxis('x');
    useToolModeStore.getState().breakPickP0(50);
  }

  it('breakPickP1() transitions to idle, calls onDispatch with (coordA, coordB)', () => {
    setupToPickP1();
    const cb = vi.fn();
    useToolModeStore.getState().breakPickP1(150, cb);
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(50, 150);
    const s = useToolModeStore.getState();
    expect(s.mode).toBe('idle');
    expect(s.breakState).toEqual({ stage: 'idle' });
  });

  it('breakPickP1() calls onDispatch exactly once', () => {
    setupToPickP1();
    const cb = vi.fn();
    useToolModeStore.getState().breakPickP1(200, cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('breakPickP1() from wrong stage is no-op + warns, callback not called', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterBreakMode(); // stage=pickParent
    const cb = vi.fn();
    useToolModeStore.getState().breakPickP1(100, cb);
    expect(cb).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('break tool — breakCancel + ESC back-tracking', () => {
  function setupAt(stage: string) {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterBreakMode(); // pickParent
    if (stage === 'pickParent') return;
    useToolModeStore.getState().breakPickParent('bv1'); // pickAxis
    if (stage === 'pickAxis') return;
    useToolModeStore.getState().breakSetAxis('x'); // pickP0
    if (stage === 'pickP0') return;
    useToolModeStore.getState().breakPickP0(50); // pickP1
  }

  it('breakCancel() from pickP1 → pickP0 (one stage back)', () => {
    setupAt('pickP1');
    useToolModeStore.getState().breakCancel();
    expect(useToolModeStore.getState().breakState).toMatchObject({ stage: 'pickP0' });
    expect(useToolModeStore.getState().mode).toBe('break');
  });

  it('breakCancel() from pickP0 → pickAxis (one stage back)', () => {
    setupAt('pickP0');
    useToolModeStore.getState().breakCancel();
    expect(useToolModeStore.getState().breakState).toMatchObject({ stage: 'pickAxis' });
    expect(useToolModeStore.getState().mode).toBe('break');
  });

  it('breakCancel() from pickAxis → pickParent (one stage back)', () => {
    setupAt('pickAxis');
    useToolModeStore.getState().breakCancel();
    expect(useToolModeStore.getState().breakState).toEqual({ stage: 'pickParent' });
    expect(useToolModeStore.getState().mode).toBe('break');
  });

  it('breakCancel() from pickParent → exits break mode entirely (mode=idle)', () => {
    setupAt('pickParent');
    useToolModeStore.getState().breakCancel();
    expect(useToolModeStore.getState().mode).toBe('idle');
    expect(useToolModeStore.getState().breakState).toEqual({ stage: 'idle' });
  });

  it('double-ESC from pickP1 exits to mode=idle', () => {
    setupAt('pickP1');
    useToolModeStore.getState().breakCancel(); // pickP1 → pickP0
    useToolModeStore.getState().breakCancel(); // pickP0 → pickAxis
    useToolModeStore.getState().breakCancel(); // pickAxis → pickParent
    useToolModeStore.getState().breakCancel(); // pickParent → idle (exits mode)
    expect(useToolModeStore.getState().mode).toBe('idle');
  });
});

// Confirm BreakToolState type is exported and satisfies its discriminant
const _typeCheck: BreakToolState = { stage: 'idle' };
void _typeCheck;

describe('sectionMode field (HS-TM-1)', () => {
  beforeEach(() => { useToolModeStore.getState().reset(); });

  it('default sectionMode is "full"', () => {
    expect(useToolModeStore.getState().sectionMode).toBe('full');
  });
  it('setSectionMode("half") → sectionMode === "half"', () => {
    useToolModeStore.getState().setSectionMode('half');
    expect(useToolModeStore.getState().sectionMode).toBe('half');
  });
  it('setSectionMode("full") → sectionMode === "full"', () => {
    useToolModeStore.getState().setSectionMode('half');
    useToolModeStore.getState().setSectionMode('full');
    expect(useToolModeStore.getState().sectionMode).toBe('full');
  });
  it('reset() clears sectionMode back to "full"', () => {
    useToolModeStore.getState().setSectionMode('half');
    useToolModeStore.getState().reset();
    expect(useToolModeStore.getState().sectionMode).toBe('full');
  });
  it('enterSectionMode() does not change sectionMode', () => {
    useToolModeStore.getState().setSectionMode('half');
    useToolModeStore.getState().enterSectionMode();
    expect(useToolModeStore.getState().sectionMode).toBe('half');
  });
});

describe('SectionToolState 5th stage — pickCutSide (HS-TM-2..6)', () => {
  // NOTE: setupToPickDrop does NOT call reset() — beforeEach handles that.
  // setSectionMode('half') must be called BEFORE setupToPickDrop because
  // sectionMode is preserved through enterSectionMode / pickP0 / pickP1.
  function setupToPickDrop() {
    useToolModeStore.getState().enterSectionMode();
    useToolModeStore.getState().sectionPickParent('v1');
    useToolModeStore.getState().sectionPickP0({ x: 10, y: 50 });
    useToolModeStore.getState().sectionPickP1({ x: 90, y: 50 });
  }
  beforeEach(() => { useToolModeStore.getState().reset(); });

  it('HS-TM-2: full-section sectionPickDrop → calls onDispatch, stage=idle', () => {
    setupToPickDrop();
    const cb = vi.fn();
    useToolModeStore.getState().sectionPickDrop({ x: 200, y: 200 }, cb);
    expect(cb).toHaveBeenCalledOnce();
    expect(useToolModeStore.getState().sectionState).toEqual({ stage: 'idle' });
  });

  it('HS-TM-3: half-section sectionPickDrop → stage=pickCutSide, pendingCutSide=1', () => {
    useToolModeStore.getState().setSectionMode('half');
    setupToPickDrop();
    const cb = vi.fn();
    useToolModeStore.getState().sectionPickDrop({ x: 200, y: 200 }, cb);
    expect(cb).not.toHaveBeenCalled();
    const s = useToolModeStore.getState().sectionState;
    expect(s.stage).toBe('pickCutSide');
    if (s.stage === 'pickCutSide') {
      expect(s.pendingCutSide).toBe(1);
      expect(s.dropAt).toEqual({ x: 200, y: 200 });
    }
  });

  it('HS-TM-4: sectionPickCutSide(-1) → pendingCutSide === -1', () => {
    useToolModeStore.getState().setSectionMode('half');
    setupToPickDrop();
    useToolModeStore.getState().sectionPickDrop({ x: 200, y: 200 }, vi.fn());
    useToolModeStore.getState().sectionPickCutSide(-1);
    const s = useToolModeStore.getState().sectionState;
    expect(s.stage).toBe('pickCutSide');
    if (s.stage === 'pickCutSide') expect(s.pendingCutSide).toBe(-1);
  });

  it('HS-TM-5: sectionCommitCutSide → onDispatch(cutSide, dropAt); stage=idle', () => {
    useToolModeStore.getState().setSectionMode('half');
    setupToPickDrop();
    useToolModeStore.getState().sectionPickDrop({ x: 200, y: 200 }, vi.fn());
    useToolModeStore.getState().sectionPickCutSide(-1);
    const commit = vi.fn();
    useToolModeStore.getState().sectionCommitCutSide(commit);
    expect(commit).toHaveBeenCalledWith(-1, { x: 200, y: 200 });
    expect(useToolModeStore.getState().sectionState).toEqual({ stage: 'idle' });
  });

  it('HS-TM-6: sectionCancel() from pickCutSide → stage=idle', () => {
    useToolModeStore.getState().setSectionMode('half');
    setupToPickDrop();
    useToolModeStore.getState().sectionPickDrop({ x: 200, y: 200 }, vi.fn());
    expect(useToolModeStore.getState().sectionState.stage).toBe('pickCutSide');
    useToolModeStore.getState().sectionCancel();
    expect(useToolModeStore.getState().sectionState).toEqual({ stage: 'idle' });
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

  it('detailCancel() from pickRegionCenter → resets detailState to idle; mode stays detail', () => {
    useToolModeStore.getState().detailPickParent('v1');
    useToolModeStore.getState().detailCancel();
    const s = useToolModeStore.getState();
    expect(s.detailState).toEqual({ stage: 'idle' });
    expect(s.mode).toBe('detail');
  });

  it('detailCancel() from pickRegionRadius → resets to idle; mode stays detail', () => {
    useToolModeStore.getState().detailPickParent('v1');
    useToolModeStore.getState().detailPickCenter({ x: 5, y: 5 });
    useToolModeStore.getState().detailCancel();
    expect(useToolModeStore.getState().detailState).toEqual({ stage: 'idle' });
    expect(useToolModeStore.getState().mode).toBe('detail');
  });

  it('detailCancel() from pickDrop → resets to idle; mode stays detail', () => {
    useToolModeStore.getState().detailPickParent('v1');
    useToolModeStore.getState().detailPickCenter({ x: 5, y: 5 });
    useToolModeStore.getState().detailPickRadius({ x: 10, y: 5 });
    useToolModeStore.getState().detailCancel();
    expect(useToolModeStore.getState().detailState).toEqual({ stage: 'idle' });
    expect(useToolModeStore.getState().mode).toBe('detail');
  });

  it('detailCancel() twice — second cancel exits detail mode entirely', () => {
    useToolModeStore.getState().detailCancel(); // first ESC: stage already idle, mode=detail → stay
    useToolModeStore.getState().detailCancel(); // second ESC: stage=idle AND mode=detail → exit
    expect(useToolModeStore.getState().mode).toBe('idle');
  });
});

// --- Stepped-section tool state (Drawing F1.2) ---

describe('stepped-section tool — enterSteppedSectionMode (SS-TM-1)', () => {
  beforeEach(() => { useToolModeStore.getState().reset(); });

  it('SS-TM-1: enterSteppedSectionMode() → mode === "pickSteppedSection", stage === "pickParent"', () => {
    useToolModeStore.getState().enterSteppedSectionMode();
    const s = useToolModeStore.getState();
    expect(s.mode).toBe('pickSteppedSection');
    expect(s.steppedSectionState).toEqual({ stage: 'pickParent' });
  });

  it('reset() from pickSteppedSection clears mode + state', () => {
    useToolModeStore.getState().enterSteppedSectionMode();
    useToolModeStore.getState().reset();
    expect(useToolModeStore.getState().mode).toBe('idle');
    expect(useToolModeStore.getState().steppedSectionState).toEqual({ stage: 'idle' });
  });

  it('default steppedSectionState is { stage: "idle" }', () => {
    expect(useToolModeStore.getState().steppedSectionState).toEqual({ stage: 'idle' });
  });
});
