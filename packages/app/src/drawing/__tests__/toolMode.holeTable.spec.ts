// packages/app/src/drawing/__tests__/toolMode.holeTable.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useToolModeStore } from '../toolMode';
import type { HoleTableToolState } from '../toolMode';

describe('HoleTableToolState — initial state', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
  });

  it('default holeTableState is { stage: "idle" }', () => {
    expect(useToolModeStore.getState().holeTableState).toEqual({ stage: 'idle' });
  });

  it('reset() restores holeTableState to { stage: "idle" }', () => {
    useToolModeStore.getState().enterHoleTableMode();
    useToolModeStore.getState().reset();
    expect(useToolModeStore.getState().holeTableState).toEqual({ stage: 'idle' });
    expect(useToolModeStore.getState().mode).toBe('idle');
  });

  it('enterHoleTableMode() → mode = "holeTable", holeTableState = { stage: "idle" }', () => {
    useToolModeStore.getState().enterHoleTableMode();
    const s = useToolModeStore.getState();
    expect(s.mode).toBe('holeTable');
    expect(s.holeTableState).toEqual({ stage: 'idle' });
  });
});

describe('holeTableCancel', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterHoleTableMode();
  });

  it('cancel from idle (mode=holeTable) → mode=idle, holeTableState={ stage: "idle" }', () => {
    useToolModeStore.getState().holeTableCancel();
    const s = useToolModeStore.getState();
    expect(s.mode).toBe('idle');
    expect(s.holeTableState).toEqual({ stage: 'idle' });
  });

  it('cancel from pickDatum stage → resets to idle, mode stays holeTable (first ESC)', () => {
    // Advance to pickDatum
    useToolModeStore.getState().holeTablePickDatum('v1', {
      kind: 'edge-endpoint', edgeId: 'e1', end: 'start',
    });
    useToolModeStore.getState().holeTableCancel();
    const s = useToolModeStore.getState();
    expect(s.holeTableState).toEqual({ stage: 'idle' });
    expect(s.mode).toBe('holeTable'); // stays in mode after first ESC from non-idle
  });

  it('cancel from idle after previous cancel exits mode entirely (second ESC)', () => {
    useToolModeStore.getState().holeTablePickDatum('v1', {
      kind: 'edge-endpoint', edgeId: 'e1', end: 'start',
    });
    useToolModeStore.getState().holeTableCancel(); // first ESC: back to idle, stays in holeTable
    useToolModeStore.getState().holeTableCancel(); // second ESC from idle: exit mode
    expect(useToolModeStore.getState().mode).toBe('idle');
  });
});

describe('holeTablePickDatum → holeTablePickPlacement flow', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterHoleTableMode();
  });

  it('pickDatum sets stage=pickDatum with viewId and datum', () => {
    useToolModeStore.getState().holeTablePickDatum('v1', {
      kind: 'arc-center', edgeId: 'e5',
    });
    const s = useToolModeStore.getState().holeTableState;
    expect(s.stage).toBe('pickDatum');
    if (s.stage === 'pickDatum') {
      expect(s.viewId).toBe('v1');
      expect(s.datum).toEqual({ kind: 'arc-center', edgeId: 'e5' });
    }
  });

  it('pickDatum when already in pickDatum is a no-op (warns, does not overwrite)', () => {
    useToolModeStore.getState().holeTablePickDatum('v1', {
      kind: 'arc-center', edgeId: 'e5',
    });
    useToolModeStore.getState().holeTablePickDatum('v2', {
      kind: 'edge-midpoint', edgeId: 'e6',
    });
    const s = useToolModeStore.getState().holeTableState;
    expect(s.stage).toBe('pickDatum');
    if (s.stage === 'pickDatum') {
      // First pick is preserved (guard fires for second)
      expect(s.viewId).toBe('v1');
    }
  });

  it('pickPlacement from pickDatum: calls onDispatch with viewId, datum, posMm; returns to idle', () => {
    useToolModeStore.getState().holeTablePickDatum('v1', {
      kind: 'edge-endpoint', edgeId: 'e1', end: 'start',
    });
    const cb = vi.fn();
    const posMm = { x: 180, y: 30 };
    useToolModeStore.getState().holeTablePickPlacement(posMm, cb);
    expect(cb).toHaveBeenCalledOnce();
    const args = cb.mock.calls[0] as [string, import('@zilventor/shared/src/drawing/types').PointRef, { x: number; y: number }];
    expect(args[0]).toBe('v1');
    expect(args[1]).toEqual({ kind: 'edge-endpoint', edgeId: 'e1', end: 'start' });
    expect(args[2]).toEqual(posMm);
    expect(useToolModeStore.getState().mode).toBe('idle');
    expect(useToolModeStore.getState().holeTableState).toEqual({ stage: 'idle' });
  });

  it('pickPlacement from idle: no-op (warns; onDispatch not called)', () => {
    const cb = vi.fn();
    useToolModeStore.getState().holeTablePickPlacement({ x: 100, y: 50 }, cb);
    expect(cb).not.toHaveBeenCalled();
    expect(useToolModeStore.getState().mode).toBe('holeTable');
  });
});
