import { describe, it, expect } from 'vitest';
import { renderPanelManufacturingDxf } from '../renderPanelManufacturingDxf';
import type { PanelManufacturingInput } from '../renderPanelManufacturingDxf';
import type { BoreOp } from '@zilventor/shared';

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

function bore(face: BoreOp['face'], u: number, v: number, diameter: number,
              depth: number | 'throughAll'): BoreOp {
  return { id: `b-${face}-${u}-${v}`, face, u, v, diameter, depth, role: 'shelfPin-system32' } as BoreOp;
}

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

describe('renderPanelManufacturingDxf — bores', () => {
  it('places a Top (front) bore at (u, v) on the BORES-FRONT layer', () => {
    const dxf = renderPanelManufacturingDxf({ ...base,
      bores: [bore('Top', 100, 50, 5, 12)] });
    expect(dxf).toContain('BORES-FRONT-5MM');
    expect(dxf).toMatch(/CIRCLE[\s\S]*?\n100\.0+\n[\s\S]*?\n50\.0+\n/);
    expect(dxf).toContain('BORE-INFO');
    expect(dxf).toContain('O5x12'); // depth label
  });
  it('mirrors a Bottom (back) bore to (u, W - v) on the BORES-BACK layer', () => {
    const dxf = renderPanelManufacturingDxf({ ...base,
      bores: [bore('Bottom', 100, 50, 8, 'throughAll')] });
    expect(dxf).toContain('BORES-BACK-8MM');
    // v=50 mirrors to W-v = 550
    expect(dxf).toMatch(/CIRCLE[\s\S]*?\n100\.0+\n[\s\S]*?\n550\.0+\n/);
    expect(dxf).toContain('O8 THRU');
  });
  it('projects a Front edge bore onto the top edge (X=v, Y=W)', () => {
    const dxf = renderPanelManufacturingDxf({ ...base,
      bores: [bore('Front', 9, 300, 5, 32)] }); // v=300 along edge, u=9 depth
    expect(dxf).toContain('BORES-EDGE-Front-5MM');
    expect(dxf).toMatch(/CIRCLE[\s\S]*?\n300\.0+\n[\s\S]*?\n600\.0+\n/);
  });
});
