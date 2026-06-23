import { describe, it, expect } from 'vitest';
import { buildManufacturingZipEntries } from '../ExportPanelManufacturingDxfCommand';
import type { PanelManufacturingInput } from '../../drawing/renderPanelManufacturingDxf';

const input = (n: number, name: string): PanelManufacturingInput => ({
  itemNumber: n, partName: name, materialName: 'White 18', qty: 1,
  spec: { length: 800, width: 600, thickness: 18, materialId: 'm', grain: 'length',
    edgeBands: { front: null, back: null, left: null, right: null } } as any,
  bores: [], grooves: [],
});

describe('buildManufacturingZipEntries', () => {
  it('produces one DXF entry per input with item-n-name.dxf filenames', () => {
    const entries = buildManufacturingZipEntries([input(1, 'Side'), input(2, 'Top Shelf')]);
    expect(Object.keys(entries)).toEqual(['item-1-Side.dxf', 'item-2-Top_Shelf.dxf']);
    expect(entries['item-1-Side.dxf']).toContain('OUTLINE');
  });
});
