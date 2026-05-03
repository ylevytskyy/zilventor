import { describe, expect, it } from 'vitest';
import { cutListRowKey, normalizeLW } from '../cutListRow';
import type { PanelSpec } from '../panel-feature';

const baseSpec = (overrides: Partial<PanelSpec> = {}): PanelSpec => ({
  length: 600,
  width: 400,
  thickness: 18,
  materialId: 'm-birch',
  grain: 'length',
  edgeBands: { front: null, back: null, left: null, right: null },
  ...overrides,
});

describe('normalizeLW', () => {
  it('preserves L/W when grain = length', () => {
    expect(normalizeLW(baseSpec({ grain: 'length', length: 400, width: 600 }))).toEqual({ L: 400, W: 600 });
  });

  it('preserves L/W when grain = width', () => {
    expect(normalizeLW(baseSpec({ grain: 'width', length: 400, width: 600 }))).toEqual({ L: 400, W: 600 });
  });

  it('swaps so L >= W when grain = none', () => {
    expect(normalizeLW(baseSpec({ grain: 'none', length: 400, width: 600 }))).toEqual({ L: 600, W: 400 });
    expect(normalizeLW(baseSpec({ grain: 'none', length: 600, width: 400 }))).toEqual({ L: 600, W: 400 });
  });
});

describe('cutListRowKey', () => {
  it('produces identical keys for identical (L,W,T,M,G)', () => {
    const a = cutListRowKey(baseSpec(), { L: 600, W: 400 });
    const b = cutListRowKey(baseSpec(), { L: 600, W: 400 });
    expect(a).toBe(b);
  });

  it('different thickness yields different keys', () => {
    const a = cutListRowKey(baseSpec({ thickness: 18 }), { L: 600, W: 400 });
    const b = cutListRowKey(baseSpec({ thickness: 19 }), { L: 600, W: 400 });
    expect(a).not.toBe(b);
  });

  it('different grain yields different keys', () => {
    const a = cutListRowKey(baseSpec({ grain: 'length' }), { L: 600, W: 400 });
    const b = cutListRowKey(baseSpec({ grain: 'width' }), { L: 600, W: 400 });
    expect(a).not.toBe(b);
  });

  it('different materialId yields different keys', () => {
    const a = cutListRowKey(baseSpec({ materialId: 'm-birch' }), { L: 600, W: 400 });
    const b = cutListRowKey(baseSpec({ materialId: 'm-oak' }), { L: 600, W: 400 });
    expect(a).not.toBe(b);
  });

  it('key shape is disjoint from bomRowKey', () => {
    const cut = cutListRowKey(baseSpec(), { L: 600, W: 400 });
    expect(cut.startsWith('L=')).toBe(true);
    expect(cut.includes('::')).toBe(false);
  });
});
