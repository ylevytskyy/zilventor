import { describe, it, expect } from 'vitest';
import type { MaterialEntry } from '../../material';
import { buildBaseCabinet } from '../baseCabinet';
import type { BaseCabinetParams } from '../types';

const carcass: MaterialEntry = {
  id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896',
};
const back: MaterialEntry = {
  id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47',
};

const REGISTRY: ReadonlyArray<MaterialEntry> = [carcass, back];

const DEFAULT_PARAMS: BaseCabinetParams = {
  name: 'Base Cabinet 1',
  width: 600, depth: 560, height: 720,
  toekickHeight: 100, toekickSetback: 50,
  shelfCount: 1,
  carcassMaterialId: 'm-birch-18',
  backMaterialId: 'm-hb-6',
  bandMaterialId: null,
};

describe('buildBaseCabinet — default params', () => {
  it('emits 7 panels in deterministic role order', () => {
    const out = buildBaseCabinet(DEFAULT_PARAMS, REGISTRY);
    expect(out.panels.map((p) => p.role)).toEqual([
      'leftSide', 'rightSide', 'bottom', 'top', 'back', 'toekick', 'shelf',
    ]);
    expect(out.panels).toHaveLength(7);
    expect(out.layout).toHaveLength(7);
  });

  it('emits a layout entry per panel with matching fileNameSuffix', () => {
    const out = buildBaseCabinet(DEFAULT_PARAMS, REGISTRY);
    const panelSuffixes = out.panels.map((p) => p.fileNameSuffix);
    const layoutSuffixes = out.layout.map((c) => c.fileNameSuffix);
    expect(layoutSuffixes).toEqual(panelSuffixes);
  });
});
