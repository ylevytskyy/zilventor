import { describe, it, expect } from 'vitest';
import { renderPanelManufacturingDxf } from '../renderPanelManufacturingDxf';
import type { PanelManufacturingInput } from '../renderPanelManufacturingDxf';
import type { BoreOp, GrooveFeature } from '@zilventor/shared';

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

function bore(role: string, u: number, v: number, diameter: number,
              depth: number | 'throughAll'): BoreOp {
  const face: BoreOp['face'] = { featureId: 'panel', role, instance: 0 };
  return { id: `b-${role}-${u}-${v}`, face, u, v, diameter, depth, role: 'shelfPin-system32' } as BoreOp;
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

describe('renderPanelManufacturingDxf — grooves/edgeband/grain', () => {
  it('draws a Top groove centered at position on the GROOVES layer', () => {
    const groove: GrooveFeature = { kind: 'groove', id: 'g1', faceRole: 'Top',
      axis: 'u', position: 10, width: 6, depth: 9 };
    const dxf = renderPanelManufacturingDxf({ ...base, grooves: [groove] });
    expect(dxf).toContain('GROOVES');
    // rect spans X 0..800 at Y 7..13 (centered: position±width/2 = 10±3)
    expect(dxf).toMatch(/\n7\.0+\n/);
    expect(dxf).toMatch(/\n13\.0+\n/);
  });
  it('draws a Bottom groove mirrored+centered: bounds W-7=593 and W-13=587', () => {
    const groove: GrooveFeature = { kind: 'groove', id: 'g2', faceRole: 'Bottom',
      axis: 'u', position: 10, width: 6, depth: 9 };
    // panel W=600; centered y0=7,y1=13; mirrored: 600-7=593, 600-13=587
    const dxf = renderPanelManufacturingDxf({ ...base, grooves: [groove] });
    expect(dxf).toMatch(/\n593\.0+\n/);
    expect(dxf).toMatch(/\n587\.0+\n/);
  });
  it('draws a vertical (axis=v) Top groove centered at position: X bounds 96 and 104', () => {
    const groove: GrooveFeature = { kind: 'groove', id: 'g3', faceRole: 'Top',
      axis: 'v', position: 100, width: 8, depth: 9 };
    // centered: x0=100-4=96, x1=100+4=104
    const dxf = renderPanelManufacturingDxf({ ...base, grooves: [groove] });
    expect(dxf).toMatch(/\n96\.0+\n/);
    expect(dxf).toMatch(/\n104\.0+\n/);
  });
  it('draws an EDGEBAND line only on banded edges', () => {
    const banded = { ...base, spec: { ...base.spec,
      edgeBands: { front: { materialId: 'e', thickness: 1 }, back: null, left: null, right: null } } };
    const dxf = renderPanelManufacturingDxf(banded as any);
    expect(dxf).toContain('EDGEBAND');
  });
  it('omits the GRAIN layer when grain is none', () => {
    const dxf = renderPanelManufacturingDxf({ ...base,
      spec: { ...base.spec, grain: 'none' } as any });
    expect(dxf).not.toContain('\nGRAIN\n');
  });
  it('draws a GRAIN arrow when grain is length', () => {
    const dxf = renderPanelManufacturingDxf(base); // grain 'length'
    expect(dxf).toContain('GRAIN');
  });
});
