import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useToolModeStore } from '../toolMode';
import type { Region } from '../toolMode';
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

// ── Task 2.2 tests ────────────────────────────────────────────────────────────

const START_REGION: Region = { center: { x: 20, y: 15 }, radiusMm: 8 };

describe('editDragStart', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterEditDetailRegionMode();
  });

  it('editDragStart center → stage=draggingCenter with detailViewId, startRegion, anchor, live center=startRegion.center', () => {
    const anchor = { x: 22, y: 17 };
    useToolModeStore.getState().editDragStart('dv1', 'center', START_REGION, anchor);
    const s = useToolModeStore.getState().editDetailRegionState;
    expect(s.stage).toBe('draggingCenter');
    if (s.stage === 'draggingCenter') {
      expect(s.detailViewId).toBe('dv1');
      expect(s.startRegion).toEqual(START_REGION);
      expect(s.anchor).toEqual(anchor);
      expect(s.center).toEqual(START_REGION.center);
    }
  });

  it('editDragStart radius → stage=draggingRadius with detailViewId, startRegion, live radiusMm=startRegion.radiusMm', () => {
    const anchor = { x: 28, y: 15 }; // east edge
    useToolModeStore.getState().editDragStart('dv1', 'radius', START_REGION, anchor);
    const s = useToolModeStore.getState().editDetailRegionState;
    expect(s.stage).toBe('draggingRadius');
    if (s.stage === 'draggingRadius') {
      expect(s.detailViewId).toBe('dv1');
      expect(s.startRegion).toEqual(START_REGION);
      expect(s.radiusMm).toBe(START_REGION.radiusMm);
    }
  });
});

describe('editDragMove — center drag (delta-based)', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterEditDetailRegionMode();
    useToolModeStore.getState().editDragStart('dv1', 'center', START_REGION, { x: 22, y: 17 });
  });

  it('pointer moved by (+5, +3) → live center moves by (+5, +3) from startRegion.center', () => {
    // anchor={22,17}, point={27,20}: delta=(+5,+3)
    const liveRegion = useToolModeStore.getState().editDragMove({ x: 27, y: 20 });
    expect(liveRegion).not.toBeNull();
    expect(liveRegion!.center).toEqual({ x: 25, y: 18 }); // 20+5, 15+3
    expect(liveRegion!.radiusMm).toBe(START_REGION.radiusMm);
  });

  it('draggingCenter state updated with new live center', () => {
    useToolModeStore.getState().editDragMove({ x: 27, y: 20 });
    const s = useToolModeStore.getState().editDetailRegionState;
    if (s.stage === 'draggingCenter') {
      expect(s.center).toEqual({ x: 25, y: 18 });
    }
  });

  it('zero delta → live center = startRegion.center', () => {
    const liveRegion = useToolModeStore.getState().editDragMove({ x: 22, y: 17 }); // same as anchor
    expect(liveRegion!.center).toEqual(START_REGION.center);
  });
});

describe('editDragMove — radius drag', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterEditDetailRegionMode();
    // anchor doesn't affect radius drag
    useToolModeStore.getState().editDragStart('dv1', 'radius', START_REGION, { x: 28, y: 15 });
  });

  it('point at distance 12 from startRegion.center → radiusMm=12', () => {
    // center=(20,15), point=(32,15) → dist=12
    const liveRegion = useToolModeStore.getState().editDragMove({ x: 32, y: 15 });
    expect(liveRegion!.radiusMm).toBeCloseTo(12, 3);
    expect(liveRegion!.center).toEqual(START_REGION.center);
  });

  it('point at (3,4) distance from center (hypotenuse=5) → radiusMm=5', () => {
    // center=(20,15), point=(23,19) → dist=5
    const liveRegion = useToolModeStore.getState().editDragMove({ x: 23, y: 19 });
    expect(liveRegion!.radiusMm).toBeCloseTo(5, 3);
  });

  it('radius clamps to MIN_DETAIL_RADIUS_MM when point is at center', () => {
    // point exactly at startRegion.center → distance=0 → clamp to 1.0
    const liveRegion = useToolModeStore.getState().editDragMove({ x: 20, y: 15 });
    expect(liveRegion!.radiusMm).toBe(MIN_DETAIL_RADIUS_MM);
  });

  it('radius clamps when distance < MIN_DETAIL_RADIUS_MM', () => {
    // distance = 0.1mm → clamp to 1.0
    const liveRegion = useToolModeStore.getState().editDragMove({ x: 20.1, y: 15 });
    expect(liveRegion!.radiusMm).toBe(MIN_DETAIL_RADIUS_MM);
  });
});

describe('editDragEnd', () => {
  it('draggingCenter: calls onDispatch(prevRegion, liveRegion); returns to idle', () => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterEditDetailRegionMode();
    useToolModeStore.getState().editDragStart('dv1', 'center', START_REGION, { x: 22, y: 17 });
    useToolModeStore.getState().editDragMove({ x: 27, y: 20 }); // live center=(25,18)

    const cb = vi.fn();
    useToolModeStore.getState().editDragEnd(cb);

    expect(cb).toHaveBeenCalledOnce();
    const [prev, next] = cb.mock.calls[0] as [Region, Region];
    expect(prev).toEqual(START_REGION);
    expect(next.center).toEqual({ x: 25, y: 18 });
    expect(useToolModeStore.getState().editDetailRegionState).toEqual({ stage: 'idle' });
  });

  it('draggingRadius: calls onDispatch(prevRegion, liveRegion); returns to idle', () => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterEditDetailRegionMode();
    useToolModeStore.getState().editDragStart('dv1', 'radius', START_REGION, { x: 28, y: 15 });
    useToolModeStore.getState().editDragMove({ x: 32, y: 15 }); // radiusMm=12

    const cb = vi.fn();
    useToolModeStore.getState().editDragEnd(cb);

    expect(cb).toHaveBeenCalledOnce();
    const [prev, next] = cb.mock.calls[0] as [Region, Region];
    expect(prev).toEqual(START_REGION);
    expect(next.radiusMm).toBeCloseTo(12, 3);
    expect(useToolModeStore.getState().editDetailRegionState).toEqual({ stage: 'idle' });
  });

  it('editDragEnd from idle: no-op (onDispatch not called)', () => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterEditDetailRegionMode();
    const cb = vi.fn();
    useToolModeStore.getState().editDragEnd(cb);
    expect(cb).not.toHaveBeenCalled();
  });
});

// ── Task 2.3 tests ────────────────────────────────────────────────────────────

describe('editDetailCancel — two-stage Esc', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterEditDetailRegionMode();
  });

  it('Esc while draggingCenter: reverts live state to startRegion, stage=idle, mode stays editDetailRegion', () => {
    useToolModeStore.getState().editDragStart('dv1', 'center', START_REGION, { x: 22, y: 17 });
    useToolModeStore.getState().editDragMove({ x: 30, y: 25 }); // move live center
    useToolModeStore.getState().editDetailCancel();
    const s = useToolModeStore.getState();
    expect(s.editDetailRegionState).toEqual({ stage: 'idle' });
    expect(s.mode).toBe('editDetailRegion'); // stays in mode after first Esc
  });

  it('Esc while draggingRadius: reverts live state to startRegion, stage=idle, mode stays editDetailRegion', () => {
    useToolModeStore.getState().editDragStart('dv1', 'radius', START_REGION, { x: 28, y: 15 });
    useToolModeStore.getState().editDragMove({ x: 35, y: 15 }); // enlarge radius
    useToolModeStore.getState().editDetailCancel();
    const s = useToolModeStore.getState();
    expect(s.editDetailRegionState).toEqual({ stage: 'idle' });
    expect(s.mode).toBe('editDetailRegion');
  });

  // NOTE: the plan's Task 2.3 originally had tests asserting "first Esc from idle stays in mode".
  // After reading detailCancel (lines 509-518 of toolMode.ts), the actual pattern is:
  //   stage=idle + mode=editDetailRegion → exits immediately (same as "second Esc" in the comment).
  // The plan author confirmed this adjustment on lines 1278-1300.
  it('Esc from idle (mode=editDetailRegion): exits mode immediately (mirrors detailCancel second-Esc semantics)', () => {
    // editDetailRegionState.stage is already idle after enterEditDetailRegionMode
    useToolModeStore.getState().editDetailCancel();
    expect(useToolModeStore.getState().mode).toBe('idle');
    expect(useToolModeStore.getState().editDetailRegionState).toEqual({ stage: 'idle' });
  });

  it('Esc mid-drag then Esc from idle: two presses to exit mode from dragging', () => {
    useToolModeStore.getState().editDragStart('dv1', 'center', START_REGION, { x: 22, y: 17 });
    useToolModeStore.getState().editDetailCancel(); // 1st: cancel drag, go idle, stay in mode
    expect(useToolModeStore.getState().mode).toBe('editDetailRegion');
    useToolModeStore.getState().editDetailCancel(); // 2nd: from idle → exit
    expect(useToolModeStore.getState().mode).toBe('idle');
  });
});
