import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './useAppStore';

describe('fileOpen store slice', () => {
  beforeEach(() => {
    useAppStore.setState({ fileOpen: null, fileOpenSeq: 0 });
  });

  it('beginFileOpen sets fileOpen and returns an incrementing token', () => {
    const token = useAppStore.getState().beginFileOpen('cube.step');
    const s = useAppStore.getState();
    expect(s.fileOpen?.fileName).toBe('cube.step');
    expect(typeof s.fileOpen?.startedAtMs).toBe('number');
    expect(token).toBe(1);
  });

  it('endFileOpen clears fileOpen when the token is current', () => {
    const token = useAppStore.getState().beginFileOpen('cube.step');
    useAppStore.getState().endFileOpen(token);
    expect(useAppStore.getState().fileOpen).toBeNull();
  });

  it('endFileOpen with a stale token does NOT clear a newer open', () => {
    const stale = useAppStore.getState().beginFileOpen('a.step');
    useAppStore.getState().beginFileOpen('b.step'); // newer open → token 2
    useAppStore.getState().endFileOpen(stale);       // stale token 1
    expect(useAppStore.getState().fileOpen?.fileName).toBe('b.step');
  });

  it('cancelFileOpen clears fileOpen and invalidates the current token', () => {
    const token = useAppStore.getState().beginFileOpen('big.step');
    useAppStore.getState().cancelFileOpen();
    expect(useAppStore.getState().fileOpen).toBeNull();
    useAppStore.getState().endFileOpen(token); // stale end must not resurrect state
    expect(useAppStore.getState().fileOpen).toBeNull();
  });
});
