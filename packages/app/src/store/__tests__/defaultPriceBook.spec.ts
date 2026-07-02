import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../useAppStore';

describe('defaultPriceBook store slice', () => {
  beforeEach(() => {
    localStorage.removeItem('defaultPriceBook');
    useAppStore.setState({ defaultPriceBook: {} });
  });

  it('defaults to an empty object', () => {
    expect(useAppStore.getState().defaultPriceBook).toEqual({});
  });

  it('setDefaultPrice adds a key and persists to localStorage', () => {
    useAppStore.getState().setDefaultPrice('material:m1', 12.5);
    expect(useAppStore.getState().defaultPriceBook).toEqual({ 'material:m1': 12.5 });
    expect(JSON.parse(localStorage.getItem('defaultPriceBook')!)).toEqual({ 'material:m1': 12.5 });
  });

  it('setDefaultPrice overwrites an existing key and persists', () => {
    useAppStore.getState().setDefaultPrice('material:m1', 12.5);
    useAppStore.getState().setDefaultPrice('material:m1', 15);
    expect(useAppStore.getState().defaultPriceBook).toEqual({ 'material:m1': 15 });
    expect(JSON.parse(localStorage.getItem('defaultPriceBook')!)).toEqual({ 'material:m1': 15 });
  });

  it('persists across a simulated reload (fresh module re-reads localStorage)', async () => {
    useAppStore.getState().setDefaultPrice('material:m1', 12.5);
    useAppStore.getState().setDefaultPrice('hardware:hinge-35mm', 3.2);

    vi.resetModules();
    const { useAppStore: reloadedStore } = await import('../useAppStore');

    expect(reloadedStore.getState().defaultPriceBook).toEqual({
      'material:m1': 12.5,
      'hardware:hinge-35mm': 3.2,
    });
  });

  it('falls back to an empty object when localStorage holds malformed JSON', async () => {
    localStorage.setItem('defaultPriceBook', '{ not json');

    vi.resetModules();
    const { useAppStore: reloadedStore } = await import('../useAppStore');

    expect(reloadedStore.getState().defaultPriceBook).toEqual({});
  });
});
