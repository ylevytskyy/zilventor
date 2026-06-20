import { describe, it, expect } from 'vitest';
import { shouldReflowAfterInvalidate, partPathForKernelId } from '../reflowDirty';

describe('shouldReflowAfterInvalidate', () => {
  it('returns true when the active document is an assembly', () => {
    expect(shouldReflowAfterInvalidate({ kind: 'assembly' })).toBe(true);
  });
  it('returns false for a part document', () => {
    expect(shouldReflowAfterInvalidate({ kind: 'part' })).toBe(false);
  });
  it('returns false for null/undefined', () => {
    expect(shouldReflowAfterInvalidate(null)).toBe(false);
    expect(shouldReflowAfterInvalidate(undefined)).toBe(false);
  });
});

describe('partPathForKernelId', () => {
  const entries: Array<[string, string]> = [
    ['parts/box.zipt', 'uuid-box'],
    ['parts/lid.zipt', 'uuid-lid'],
  ];
  it('inverts the partPath→kernelId map to recover the OPFS path', () => {
    expect(partPathForKernelId(entries, 'uuid-lid')).toBe('parts/lid.zipt');
  });
  it('returns undefined when the kernel id was never loaded in assembly context', () => {
    expect(partPathForKernelId(entries, 'uuid-standalone')).toBeUndefined();
  });
});
