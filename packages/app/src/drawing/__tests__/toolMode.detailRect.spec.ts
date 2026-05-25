// packages/app/src/drawing/__tests__/toolMode.detailRect.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useToolModeStore } from '../toolMode';
import type { DetailRectToolState, Region } from '../toolMode';
import { MIN_DETAIL_RECT_MM } from '../drawingConstants';

describe('detailRect ToolMode — initial state', () => {
  beforeEach(() => { useToolModeStore.getState().reset(); });

  it('detailRectState is { stage: "idle" } after reset', () => {
    const s = useToolModeStore.getState();
    expect(s.detailRectState).toEqual({ stage: 'idle' });
  });

  it('enterDetailRectMode() → mode="detailRect", stage="idle"', () => {
    useToolModeStore.getState().enterDetailRectMode();
    const s = useToolModeStore.getState();
    expect(s.mode).toBe('detailRect');
    expect(s.detailRectState).toEqual({ stage: 'idle' });
  });

  it('reset() after enterDetailRectMode() → mode="idle", detailRectState={ stage:"idle" }', () => {
    useToolModeStore.getState().enterDetailRectMode();
    useToolModeStore.getState().reset();
    const s = useToolModeStore.getState();
    expect(s.mode).toBe('idle');
    expect(s.detailRectState).toEqual({ stage: 'idle' });
  });
});

// ── Stage transitions ─────────────────────────────────────────────────────────

describe('detailRect — stage transitions', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterDetailRectMode();
  });

  it('idle → pickFirstCorner after detailRectPickParent(viewId)', () => {
    useToolModeStore.getState().detailRectPickParent('v1');
    const s = useToolModeStore.getState().detailRectState;
    expect(s.stage).toBe('pickFirstCorner');
    if (s.stage === 'pickFirstCorner') {
      expect(s.parentViewId).toBe('v1');
    }
  });

  it('pickFirstCorner → pickSecondCorner after detailRectPickFirstCorner(point)', () => {
    useToolModeStore.getState().detailRectPickParent('v1');
    useToolModeStore.getState().detailRectPickFirstCorner({ x: 10, y: 20 });
    const s = useToolModeStore.getState().detailRectState;
    expect(s.stage).toBe('pickSecondCorner');
    if (s.stage === 'pickSecondCorner') {
      expect(s.firstCorner).toEqual({ x: 10, y: 20 });
      expect(s.parentViewId).toBe('v1');
    }
  });

  it('pickSecondCorner → pickDrop with computed center/widthMm/heightMm', () => {
    useToolModeStore.getState().detailRectPickParent('v1');
    useToolModeStore.getState().detailRectPickFirstCorner({ x: 10, y: 20 });
    // Second corner at (30, 50): dx=20, dy=30, center=(20,35)
    useToolModeStore.getState().detailRectPickSecondCorner({ x: 30, y: 50 });
    const s = useToolModeStore.getState().detailRectState;
    expect(s.stage).toBe('pickDrop');
    if (s.stage === 'pickDrop') {
      expect(s.center).toEqual({ x: 20, y: 35 });
      expect(s.widthMm).toBe(20);
      expect(s.heightMm).toBe(30);
      expect(s.parentViewId).toBe('v1');
    }
  });

  it('widthMm clamps to MIN_DETAIL_RECT_MM when second corner is same X as first', () => {
    useToolModeStore.getState().detailRectPickParent('v1');
    useToolModeStore.getState().detailRectPickFirstCorner({ x: 10, y: 20 });
    useToolModeStore.getState().detailRectPickSecondCorner({ x: 10, y: 50 }); // dx=0
    const s = useToolModeStore.getState().detailRectState;
    if (s.stage === 'pickDrop') {
      expect(s.widthMm).toBe(MIN_DETAIL_RECT_MM);
      expect(s.heightMm).toBe(30);
    }
  });

  it('heightMm clamps to MIN_DETAIL_RECT_MM when second corner is same Y as first', () => {
    useToolModeStore.getState().detailRectPickParent('v1');
    useToolModeStore.getState().detailRectPickFirstCorner({ x: 10, y: 20 });
    useToolModeStore.getState().detailRectPickSecondCorner({ x: 30, y: 20 }); // dy=0
    const s = useToolModeStore.getState().detailRectState;
    if (s.stage === 'pickDrop') {
      expect(s.widthMm).toBe(20);
      expect(s.heightMm).toBe(MIN_DETAIL_RECT_MM);
    }
  });

  it('negative-direction marquee normalises to positive widthMm/heightMm', () => {
    useToolModeStore.getState().detailRectPickParent('v1');
    useToolModeStore.getState().detailRectPickFirstCorner({ x: 30, y: 50 });
    // Drag leftward+upward to (10, 20)
    useToolModeStore.getState().detailRectPickSecondCorner({ x: 10, y: 20 });
    const s = useToolModeStore.getState().detailRectState;
    if (s.stage === 'pickDrop') {
      expect(s.widthMm).toBe(20);   // |10-30|
      expect(s.heightMm).toBe(30);  // |20-50|
      expect(s.center).toEqual({ x: 20, y: 35 });
    }
  });
});

// ── pickDrop → dispatch ───────────────────────────────────────────────────────

describe('detailRect — pickDrop', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterDetailRectMode();
    useToolModeStore.getState().detailRectPickParent('v1');
    useToolModeStore.getState().detailRectPickFirstCorner({ x: 10, y: 20 });
    useToolModeStore.getState().detailRectPickSecondCorner({ x: 30, y: 50 });
  });

  it('detailRectPickDrop calls onDispatch once', () => {
    const cb = vi.fn();
    useToolModeStore.getState().detailRectPickDrop({ x: 150, y: 200 }, cb);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('detailRectPickDrop resets to mode=idle after dispatch', () => {
    const cb = vi.fn();
    useToolModeStore.getState().detailRectPickDrop({ x: 150, y: 200 }, cb);
    const s = useToolModeStore.getState();
    expect(s.mode).toBe('idle');
    expect(s.detailRectState).toEqual({ stage: 'idle' });
  });

  it('detailRectPickDrop is a no-op when stage != pickDrop', () => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterDetailRectMode();
    // stage is idle here
    const cb = vi.fn();
    useToolModeStore.getState().detailRectPickDrop({ x: 0, y: 0 }, cb);
    expect(cb).not.toHaveBeenCalled();
  });
});

// ── ESC behaviour ─────────────────────────────────────────────────────────────

describe('detailRect — detailRectCancel (ESC double-press)', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterDetailRectMode();
  });

  it('ESC at pickFirstCorner stage → back to idle stage, stay in detailRect mode', () => {
    useToolModeStore.getState().detailRectPickParent('v1');
    expect(useToolModeStore.getState().detailRectState.stage).toBe('pickFirstCorner');
    useToolModeStore.getState().detailRectCancel();
    const s = useToolModeStore.getState();
    expect(s.detailRectState).toEqual({ stage: 'idle' });
    expect(s.mode).toBe('detailRect');
  });

  it('ESC at pickSecondCorner stage → back to idle stage, stay in detailRect mode', () => {
    useToolModeStore.getState().detailRectPickParent('v1');
    useToolModeStore.getState().detailRectPickFirstCorner({ x: 10, y: 20 });
    useToolModeStore.getState().detailRectCancel();
    const s = useToolModeStore.getState();
    expect(s.detailRectState).toEqual({ stage: 'idle' });
    expect(s.mode).toBe('detailRect');
  });

  it('ESC at pickDrop stage → back to idle stage, stay in detailRect mode', () => {
    useToolModeStore.getState().detailRectPickParent('v1');
    useToolModeStore.getState().detailRectPickFirstCorner({ x: 10, y: 20 });
    useToolModeStore.getState().detailRectPickSecondCorner({ x: 30, y: 50 });
    useToolModeStore.getState().detailRectCancel();
    const s = useToolModeStore.getState();
    expect(s.detailRectState).toEqual({ stage: 'idle' });
    expect(s.mode).toBe('detailRect');
  });

  it('ESC at stage=idle + mode=detailRect → exits tool (mode=idle)', () => {
    // stage already idle after enterDetailRectMode
    useToolModeStore.getState().detailRectCancel();
    const s = useToolModeStore.getState();
    expect(s.mode).toBe('idle');
    expect(s.detailRectState).toEqual({ stage: 'idle' });
  });

  it('ESC mid-flow then second ESC → two presses to exit mode', () => {
    useToolModeStore.getState().detailRectPickParent('v1');
    useToolModeStore.getState().detailRectCancel(); // 1st: reset stage, stay in mode
    expect(useToolModeStore.getState().mode).toBe('detailRect');
    useToolModeStore.getState().detailRectCancel(); // 2nd: from idle → exit
    expect(useToolModeStore.getState().mode).toBe('idle');
  });
});
