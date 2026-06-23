import { describe, it, expect } from 'vitest';
import { renderPanelManufacturingDxf } from '../renderPanelManufacturingDxf';
import type { PanelManufacturingInput } from '../renderPanelManufacturingDxf';

const base: PanelManufacturingInput = {
  itemNumber: 1,
  partName: 'SidePanel',
  materialName: 'Egger White 18',
  qty: 2,
  spec: { length: 800, width: 600, thickness: 18, materialId: 'm1', grain: 'length',
    edgeBands: { front: null, back: null, left: null, right: null } } as any,
  bores: [],
  grooves: [],
};

describe('renderPanelManufacturingDxf — outline/info/dims', () => {
  it('draws a closed outline polyline at L x W on the OUTLINE layer', () => {
    const dxf = renderPanelManufacturingDxf(base);
    expect(dxf).toContain('OUTLINE');
    expect(dxf).toContain('LWPOLYLINE');
    // four corners of an 800x600 rect present as vertices
    expect(dxf).toMatch(/\n800\.0+\n/);
    expect(dxf).toMatch(/\n600\.0+\n/);
  });
  it('emits an INFO text block with item#, material, dims, qty', () => {
    const dxf = renderPanelManufacturingDxf(base);
    expect(dxf).toContain('INFO');
    expect(dxf).toContain('#1');
    expect(dxf).toContain('Egger White 18');
    expect(dxf).toContain('800x600x18');
    expect(dxf).toContain('Qty: 2');
  });
  it('emits two native DIMENSION entities for L and W', () => {
    const dxf = renderPanelManufacturingDxf(base);
    const dims = dxf.match(/\nDIMENSION\n/g) ?? [];
    expect(dims.length).toBe(2);
    expect(dxf).toContain('DIMENSIONS');
  });
});
