import { describe, it, expect } from 'vitest';
import { useAppStore } from '../useAppStore';

describe('activeDrawingSourceComponentColors slot', () => {
  it('defaults to null and is settable', () => {
    expect(useAppStore.getState().activeDrawingSourceComponentColors).toBeNull();
    useAppStore.setState({ activeDrawingSourceComponentColors: { P1: '#112233' } } as never);
    expect(useAppStore.getState().activeDrawingSourceComponentColors).toEqual({ P1: '#112233' });
    useAppStore.setState({ activeDrawingSourceComponentColors: null } as never); // reset for other tests
  });
});
