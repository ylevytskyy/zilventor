import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../useAppStore';
import type { MachiningPreset } from '@zilventor/shared';

const preset1: MachiningPreset = {
  id: 'preset-1',
  name: 'Confirmat face bore',
  opType: 'confirmat-face',
  diameter: 8,
  depth: 13,
  layerName: 'CONFIRMAT',
};
const preset2: MachiningPreset = {
  id: 'preset-2',
  name: 'Shelf pin',
  opType: 'shelfPin-system32',
  diameter: 5,
  depth: 13,
  offset: 37,
  layerName: 'SHELFPIN',
  toolNumber: 4,
  speed: 3000,
};

describe('machiningPresets store slice', () => {
  beforeEach(() => {
    localStorage.removeItem('machiningPresets');
    useAppStore.setState({ machiningPresets: [] });
  });

  it('defaults to an empty array', () => {
    expect(useAppStore.getState().machiningPresets).toEqual([]);
  });

  it('addMachiningPreset appends and persists to localStorage', () => {
    useAppStore.getState().addMachiningPreset(preset1);
    expect(useAppStore.getState().machiningPresets).toEqual([preset1]);
    expect(JSON.parse(localStorage.getItem('machiningPresets')!)).toEqual([preset1]);
  });

  it('updateMachiningPreset replaces the matching preset and persists', () => {
    useAppStore.getState().addMachiningPreset(preset1);
    const updated: MachiningPreset = { ...preset1, diameter: 10 };
    useAppStore.getState().updateMachiningPreset(updated);
    expect(useAppStore.getState().machiningPresets).toEqual([updated]);
    expect(JSON.parse(localStorage.getItem('machiningPresets')!)).toEqual([updated]);
  });

  it('deleteMachiningPreset removes by id and persists', () => {
    useAppStore.getState().addMachiningPreset(preset1);
    useAppStore.getState().addMachiningPreset(preset2);
    useAppStore.getState().deleteMachiningPreset(preset1.id);
    expect(useAppStore.getState().machiningPresets).toEqual([preset2]);
    expect(JSON.parse(localStorage.getItem('machiningPresets')!)).toEqual([preset2]);
  });

  it('importMachiningPresets appends multiple presets and persists', () => {
    useAppStore.getState().importMachiningPresets([preset1, preset2]);
    expect(useAppStore.getState().machiningPresets).toEqual([preset1, preset2]);
    expect(JSON.parse(localStorage.getItem('machiningPresets')!)).toEqual([preset1, preset2]);
  });

  it('persists across a simulated reload (fresh module re-reads localStorage)', async () => {
    useAppStore.getState().addMachiningPreset(preset1);
    useAppStore.getState().addMachiningPreset(preset2);

    vi.resetModules();
    const { useAppStore: reloadedStore } = await import('../useAppStore');

    expect(reloadedStore.getState().machiningPresets).toEqual([preset1, preset2]);
  });

  it('falls back to an empty array when localStorage holds malformed JSON', async () => {
    localStorage.setItem('machiningPresets', '{ not json');

    vi.resetModules();
    const { useAppStore: reloadedStore } = await import('../useAppStore');

    expect(reloadedStore.getState().machiningPresets).toEqual([]);
  });
});
