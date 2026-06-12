import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../useAppStore';

describe('useAppStore clash slice', () => {
  beforeEach(() => {
    useAppStore.setState({ clashRows: null, clashRan: false, clashHighlightKeys: [] } as any);
  });

  it('initial state: clashRows=null, clashRan=false, clashHighlightKeys=[]', () => {
    const s = useAppStore.getState();
    expect(s.clashRows).toBeNull();
    expect(s.clashRan).toBe(false);
    expect(s.clashHighlightKeys).toEqual([]);
  });

  it('setClashResult populates clashRows and sets clashRan=true', () => {
    const rows = [
      { aPathKey: 'A', bPathKey: 'B', aPath: ['A'], bPath: ['B'], aName: 'P1', bName: 'P2', kind: 'interference' as const, volume: 500 },
    ];
    useAppStore.getState().setClashResult(rows);
    const s = useAppStore.getState();
    expect(s.clashRows).toHaveLength(1);
    expect(s.clashRan).toBe(true);
  });

  it('setClashResult(null) resets clashRan to false', () => {
    useAppStore.getState().setClashResult([]);
    useAppStore.getState().setClashResult(null);
    const s = useAppStore.getState();
    expect(s.clashRows).toBeNull();
    expect(s.clashRan).toBe(false);
  });

  it('setClashHighlightKeys stores the keys', () => {
    useAppStore.getState().setClashHighlightKeys(['A', 'B']);
    expect(useAppStore.getState().clashHighlightKeys).toEqual(['A', 'B']);
  });

  it('setClashHighlightKeys([]) clears highlights', () => {
    useAppStore.getState().setClashHighlightKeys(['A']);
    useAppStore.getState().setClashHighlightKeys([]);
    expect(useAppStore.getState().clashHighlightKeys).toEqual([]);
  });
});
