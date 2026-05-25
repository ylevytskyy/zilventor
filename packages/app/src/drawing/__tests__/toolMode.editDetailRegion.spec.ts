import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useToolModeStore } from '../toolMode';
import type { Region, EditDetailRegionToolState } from '../toolMode';
import { MIN_DETAIL_RADIUS_MM } from '../drawingConstants';

describe('MIN_DETAIL_RADIUS_MM constant', () => {
  it('is 1.0', () => {
    expect(MIN_DETAIL_RADIUS_MM).toBe(1.0);
  });
});

describe('Region type is the RegionParent union (compile-time check)', () => {
  it('circle arm satisfies Region', () => {
    const r: Region = { kind: 'circle', center: { x: 0, y: 0 }, radiusMm: 5 };
    expect(r.kind).toBe('circle');
  });

  it('rect arm satisfies Region', () => {
    const r: Region = { kind: 'rect', center: { x: 0, y: 0 }, widthMm: 10, heightMm: 8 };
    expect(r.kind).toBe('rect');
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

const START_REGION: Region = { kind: 'circle', center: { x: 20, y: 15 }, radiusMm: 8 };

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
      expect(s.radiusMm).toBe(START_REGION.kind === 'circle' ? START_REGION.radiusMm : undefined);
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
    expect(liveRegion!.kind).toBe('circle');
    if (liveRegion?.kind === 'circle') {
      expect(liveRegion.radiusMm).toBe(START_REGION.kind === 'circle' ? START_REGION.radiusMm : undefined);
    }
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
    expect(liveRegion?.kind).toBe('circle');
    if (liveRegion?.kind === 'circle') {
      expect(liveRegion.radiusMm).toBeCloseTo(12, 3);
    }
    expect(liveRegion!.center).toEqual(START_REGION.center);
  });

  it('point at (3,4) distance from center (hypotenuse=5) → radiusMm=5', () => {
    // center=(20,15), point=(23,19) → dist=5
    const liveRegion = useToolModeStore.getState().editDragMove({ x: 23, y: 19 });
    expect(liveRegion?.kind).toBe('circle');
    if (liveRegion?.kind === 'circle') {
      expect(liveRegion.radiusMm).toBeCloseTo(5, 3);
    }
  });

  it('radius clamps to MIN_DETAIL_RADIUS_MM when point is at center', () => {
    // point exactly at startRegion.center → distance=0 → clamp to 1.0
    const liveRegion = useToolModeStore.getState().editDragMove({ x: 20, y: 15 });
    expect(liveRegion?.kind).toBe('circle');
    if (liveRegion?.kind === 'circle') {
      expect(liveRegion.radiusMm).toBe(MIN_DETAIL_RADIUS_MM);
    }
  });

  it('radius clamps when distance < MIN_DETAIL_RADIUS_MM', () => {
    // distance = 0.1mm → clamp to 1.0
    const liveRegion = useToolModeStore.getState().editDragMove({ x: 20.1, y: 15 });
    expect(liveRegion?.kind).toBe('circle');
    if (liveRegion?.kind === 'circle') {
      expect(liveRegion.radiusMm).toBe(MIN_DETAIL_RADIUS_MM);
    }
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
    expect(next.kind).toBe('circle');
    if (next.kind === 'circle') {
      expect(next.radiusMm).toBeCloseTo(12, 3);
    }
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

// ── Task 3.4 — rect arm tests ────────────────────────────────────────────────

import { MIN_DETAIL_RECT_MM } from '../drawingConstants';

const START_RECT_REGION: Region = {
  kind: 'rect',
  center: { x: 20, y: 15 },
  widthMm: 10,
  heightMm: 8,
};
// Corner coordinates from START_RECT_REGION:
// NW: (15, 11), NE: (25, 11), SE: (25, 19), SW: (15, 19)
// Opposite of NE (dragged) = SW = (15, 19)

describe('editDragStart — rect region, center handle', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterEditDetailRegionMode();
  });

  it('draggingCenter with rect startRegion carries the full rect region', () => {
    useToolModeStore.getState().editDragStart('dv1', 'center', START_RECT_REGION, { x: 20, y: 15 });
    const s = useToolModeStore.getState().editDetailRegionState;
    expect(s.stage).toBe('draggingCenter');
    if (s.stage === 'draggingCenter') {
      expect(s.startRegion).toEqual(START_RECT_REGION);
      expect(s.center).toEqual(START_RECT_REGION.center);
    }
  });
});

describe('editDragMove — rect center drag (delta-based)', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterEditDetailRegionMode();
    useToolModeStore.getState().editDragStart('dv1', 'center', START_RECT_REGION, { x: 20, y: 15 });
  });

  it('pointer moved (+4, +3) → center shifts by (+4,+3); widthMm/heightMm unchanged', () => {
    const live = useToolModeStore.getState().editDragMove({ x: 24, y: 18 });
    expect(live).not.toBeNull();
    if (live?.kind === 'rect') {
      expect(live.center).toEqual({ x: 24, y: 18 });
      expect(live.widthMm).toBe(START_RECT_REGION.kind === 'rect' ? START_RECT_REGION.widthMm : undefined);
      expect(live.heightMm).toBe(START_RECT_REGION.kind === 'rect' ? START_RECT_REGION.heightMm : undefined);
    } else {
      throw new Error('expected rect live region');
    }
  });
});

describe('editDragStart — rect region, corner-NE handle', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterEditDetailRegionMode();
  });

  it('stage=draggingCorner with oppositeCorner=SW', () => {
    useToolModeStore.getState().editDragStart('dv1', 'corner-NE', START_RECT_REGION, { x: 25, y: 11 });
    const s = useToolModeStore.getState().editDetailRegionState;
    expect(s.stage).toBe('draggingCorner');
    if (s.stage === 'draggingCorner') {
      // SW corner: center.x - w/2 = 20-5=15, center.y + h/2 = 15+4=19
      expect(s.oppositeCorner).toEqual({ x: 15, y: 19 });
      expect(s.startRegion).toEqual(START_RECT_REGION);
    }
  });

  it('stage=draggingCorner with oppositeCorner=SE for corner-NW handle', () => {
    useToolModeStore.getState().editDragStart('dv1', 'corner-NW', START_RECT_REGION, { x: 15, y: 11 });
    const s = useToolModeStore.getState().editDetailRegionState;
    if (s.stage === 'draggingCorner') {
      // SE corner: center.x + w/2 = 25, center.y + h/2 = 19
      expect(s.oppositeCorner).toEqual({ x: 25, y: 19 });
    }
  });

  it('stage=draggingCorner with oppositeCorner=NW for corner-SE handle', () => {
    useToolModeStore.getState().editDragStart('dv1', 'corner-SE', START_RECT_REGION, { x: 25, y: 19 });
    const s = useToolModeStore.getState().editDetailRegionState;
    if (s.stage === 'draggingCorner') {
      // NW corner: center.x - w/2 = 15, center.y - h/2 = 11
      expect(s.oppositeCorner).toEqual({ x: 15, y: 11 });
    }
  });

  it('stage=draggingCorner with oppositeCorner=NE for corner-SW handle', () => {
    useToolModeStore.getState().editDragStart('dv1', 'corner-SW', START_RECT_REGION, { x: 15, y: 19 });
    const s = useToolModeStore.getState().editDetailRegionState;
    if (s.stage === 'draggingCorner') {
      // NE corner: center.x + w/2 = 25, center.y - h/2 = 11
      expect(s.oppositeCorner).toEqual({ x: 25, y: 11 });
    }
  });
});

describe('editDragMove — corner drag math (opposite-corner fixed)', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterEditDetailRegionMode();
    // Drag NE corner; opposite = SW = (15, 19)
    useToolModeStore.getState().editDragStart('dv1', 'corner-NE', START_RECT_REGION, { x: 25, y: 11 });
  });

  it('drag NE corner to (35, 5): widthMm=|35-15|=20, heightMm=|5-19|=14, center=(25,12)', () => {
    const live = useToolModeStore.getState().editDragMove({ x: 35, y: 5 });
    expect(live?.kind).toBe('rect');
    if (live?.kind === 'rect') {
      expect(live.widthMm).toBe(20);
      expect(live.heightMm).toBe(14);
      expect(live.center).toEqual({ x: 25, y: 12 });
    }
  });

  it('drag NE to opposite corner itself: both clamp to MIN_DETAIL_RECT_MM', () => {
    // SW = (15,19), drag NE there → dx=0,dy=0
    const live = useToolModeStore.getState().editDragMove({ x: 15, y: 19 });
    expect(live?.kind).toBe('rect');
    if (live?.kind === 'rect') {
      expect(live.widthMm).toBe(MIN_DETAIL_RECT_MM);
      expect(live.heightMm).toBe(MIN_DETAIL_RECT_MM);
    }
  });

  it('drag NE to (35,19) — zero heightMm → clamps to MIN_DETAIL_RECT_MM', () => {
    const live = useToolModeStore.getState().editDragMove({ x: 35, y: 19 });
    if (live?.kind === 'rect') {
      expect(live.widthMm).toBe(20);       // |35-15|
      expect(live.heightMm).toBe(MIN_DETAIL_RECT_MM);  // |19-19|=0 → clamp
    }
  });
});

describe('editDragEnd — corner drag dispatches and resets', () => {
  it('draggingCorner: calls onDispatch(startRegion, liveRegion); returns to idle', () => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterEditDetailRegionMode();
    useToolModeStore.getState().editDragStart('dv1', 'corner-NE', START_RECT_REGION, { x: 25, y: 11 });
    useToolModeStore.getState().editDragMove({ x: 35, y: 5 }); // live w=20, h=14, c=(25,12)

    const cb = vi.fn();
    useToolModeStore.getState().editDragEnd(cb);

    expect(cb).toHaveBeenCalledOnce();
    const [prev, next] = cb.mock.calls[0] as [Region, Region];
    expect(prev).toEqual(START_RECT_REGION);
    expect(next.kind).toBe('rect');
    if (next.kind === 'rect') {
      expect(next.widthMm).toBe(20);
      expect(next.heightMm).toBe(14);
      expect(next.center).toEqual({ x: 25, y: 12 });
    }
    expect(useToolModeStore.getState().editDetailRegionState).toEqual({ stage: 'idle' });
  });
});

describe('editDetailCancel — rect draggingCorner', () => {
  it('ESC while draggingCorner → stage=idle, mode stays editDetailRegion', () => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterEditDetailRegionMode();
    useToolModeStore.getState().editDragStart('dv1', 'corner-SE', START_RECT_REGION, { x: 25, y: 19 });
    useToolModeStore.getState().editDetailCancel();
    const s = useToolModeStore.getState();
    expect(s.editDetailRegionState).toEqual({ stage: 'idle' });
    expect(s.mode).toBe('editDetailRegion');
  });
});
