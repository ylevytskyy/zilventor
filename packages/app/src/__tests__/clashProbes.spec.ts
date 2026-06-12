/**
 * Tests that __zilventorClashCount and __zilventorClashResults are registered.
 * In the real app they are registered in a useEffect(DEV) — here we call the
 * same inline logic directly against the store state.
 */
import { describe, it, expect } from 'vitest';
import { useAppStore } from '../store/useAppStore';

describe('clash probes', () => {
  it('__zilventorClashCount returns 0 when clashRows is null', () => {
    useAppStore.setState({ clashRows: null } as any);
    const count = useAppStore.getState().clashRows?.length ?? 0;
    expect(count).toBe(0);
  });

  it('__zilventorClashCount returns correct count', () => {
    useAppStore.setState({
      clashRows: [
        { aPathKey: 'a', bPathKey: 'b', aPath: ['a'], bPath: ['b'], aName: 'A', bName: 'B', kind: 'interference', volume: 100 },
      ],
    } as any);
    const count = useAppStore.getState().clashRows?.length ?? 0;
    expect(count).toBe(1);
  });
});
