import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../useAppStore';
import type { LabelHeaderPreset } from '../labelHeaderPreset';

const preset1: LabelHeaderPreset = {
  id: 'preset-1',
  name: 'Acme Kitchens',
  line1: 'Acme Kitchens Ltd.',
  line2: 'Job #1042',
};
const preset2: LabelHeaderPreset = {
  id: 'preset-2',
  name: 'Bespoke Joinery',
  line1: 'Bespoke Joinery Co.',
  line2: 'Order 88',
};

describe('labelHeaderPresets store slice', () => {
  beforeEach(() => {
    localStorage.removeItem('labelHeaderPresets');
    useAppStore.setState({ labelHeaderPresets: [] });
  });

  it('defaults to an empty array', () => {
    expect(useAppStore.getState().labelHeaderPresets).toEqual([]);
  });

  it('addLabelHeaderPreset appends and persists to localStorage', () => {
    useAppStore.getState().addLabelHeaderPreset(preset1);
    expect(useAppStore.getState().labelHeaderPresets).toEqual([preset1]);
    expect(JSON.parse(localStorage.getItem('labelHeaderPresets')!)).toEqual([preset1]);
  });

  it('updateLabelHeaderPreset replaces the matching preset and persists', () => {
    useAppStore.getState().addLabelHeaderPreset(preset1);
    const updated: LabelHeaderPreset = { ...preset1, line2: 'Job #1043' };
    useAppStore.getState().updateLabelHeaderPreset(updated);
    expect(useAppStore.getState().labelHeaderPresets).toEqual([updated]);
    expect(JSON.parse(localStorage.getItem('labelHeaderPresets')!)).toEqual([updated]);
  });

  it('importLabelHeaderPresets appends multiple presets and persists', () => {
    useAppStore.getState().importLabelHeaderPresets([preset1, preset2]);
    expect(useAppStore.getState().labelHeaderPresets).toEqual([preset1, preset2]);
    expect(JSON.parse(localStorage.getItem('labelHeaderPresets')!)).toEqual([preset1, preset2]);
  });

  it('deleteLabelHeaderPreset removes by id and persists', () => {
    useAppStore.getState().addLabelHeaderPreset(preset1);
    useAppStore.getState().addLabelHeaderPreset(preset2);
    useAppStore.getState().deleteLabelHeaderPreset(preset1.id);
    expect(useAppStore.getState().labelHeaderPresets).toEqual([preset2]);
    expect(JSON.parse(localStorage.getItem('labelHeaderPresets')!)).toEqual([preset2]);
  });

  it('persists across a simulated reload (fresh module re-reads localStorage)', async () => {
    useAppStore.getState().addLabelHeaderPreset(preset1);
    useAppStore.getState().addLabelHeaderPreset(preset2);

    vi.resetModules();
    const { useAppStore: reloadedStore } = await import('../useAppStore');

    expect(reloadedStore.getState().labelHeaderPresets).toEqual([preset1, preset2]);
  });

  it('falls back to an empty array when localStorage holds malformed JSON', async () => {
    localStorage.setItem('labelHeaderPresets', '{ not json');

    vi.resetModules();
    const { useAppStore: reloadedStore } = await import('../useAppStore');

    expect(reloadedStore.getState().labelHeaderPresets).toEqual([]);
  });

  describe('session-only label export fields', () => {
    beforeEach(() => {
      localStorage.removeItem('labelTemplate');
      localStorage.removeItem('labelHeaderLine1');
      localStorage.removeItem('labelHeaderLine2');
    });

    it('setLabelTemplate updates state without touching localStorage', () => {
      useAppStore.getState().setLabelTemplate('compact');
      expect(useAppStore.getState().labelTemplate).toBe('compact');
      expect(localStorage.getItem('labelTemplate')).toBeNull();
    });

    it('setLabelHeaderLine1 updates state without touching localStorage', () => {
      useAppStore.getState().setLabelHeaderLine1('Acme Kitchens Ltd.');
      expect(useAppStore.getState().labelHeaderLine1).toBe('Acme Kitchens Ltd.');
      expect(localStorage.getItem('labelHeaderLine1')).toBeNull();
    });

    it('setLabelHeaderLine2 updates state without touching localStorage', () => {
      useAppStore.getState().setLabelHeaderLine2('Job #1042');
      expect(useAppStore.getState().labelHeaderLine2).toBe('Job #1042');
      expect(localStorage.getItem('labelHeaderLine2')).toBeNull();
    });
  });
});
