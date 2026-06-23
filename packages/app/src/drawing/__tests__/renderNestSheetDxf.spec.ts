import { describe, it, expect } from 'vitest';
import { renderNestSheetDxf } from '../renderNestSheetDxf';
import type { NestSheet } from '@zilventor/shared';

// Extract every LWPOLYLINE as { layer, bbox } — format-agnostic (parseFloat).
function lwpolys(dxf: string): Array<{ layer: string; minX: number; minY: number; w: number; h: number }> {
  const lines = dxf.split('\n');
  const out: Array<{ layer: string; minX: number; minY: number; w: number; h: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '  0' && lines[i + 1] === 'LWPOLYLINE') {
      let layer = '';
      const xs: number[] = [];
      const ys: number[] = [];
      for (let j = i + 2; j < lines.length; j++) {
        if (lines[j] === '  0') break;
        if (lines[j] === '  8') layer = lines[j + 1]!;
        if (lines[j] === ' 10' && lines[j + 2] === ' 20') { xs.push(parseFloat(lines[j + 1]!)); ys.push(parseFloat(lines[j + 3]!)); }
      }
      out.push({ layer, minX: Math.min(...xs), minY: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
    }
  }
  return out;
}

const sheet: NestSheet = {
  materialId: 'mdf18',
  sheetIndex: 0,
  sheetLengthMm: 2800,
  sheetWidthMm: 2070,
  utilizationPct: 85.5,
  panels: [
    { itemNumber: 1, rowKey: 'a', x: 10, y: 20, length: 600, width: 300, rotated: false },
    { itemNumber: 2, rowKey: 'b', x: 700, y: 20, length: 300, width: 600, rotated: true },
  ],
};

describe('renderNestSheetDxf', () => {
  it('emits SHEET boundary, OUTLINE rects (rotated footprint already baked in), INFO labels', () => {
    const dxf = renderNestSheetDxf(sheet, { sheetCount: 3, materialName: 'White 18' });
    const polys = lwpolys(dxf);

    const sheetPoly = polys.find((p) => p.layer === 'SHEET')!;
    expect(sheetPoly).toMatchObject({ minX: 0, minY: 0, w: 2800, h: 2070 });

    const outlines = polys.filter((p) => p.layer === 'OUTLINE');
    expect(outlines).toHaveLength(2);
    // Non-rotated panel: drawn w=length=600, h=width=300.
    expect(outlines).toContainEqual({ layer: 'OUTLINE', minX: 10, minY: 20, w: 600, h: 300 });
    // Rotated panel: NO extra swap — drawn w=length=300, h=width=600.
    expect(outlines).toContainEqual({ layer: 'OUTLINE', minX: 700, minY: 20, w: 300, h: 600 });

    // INFO: 2 panel labels + 1 header = 3 TEXT entities.
    expect((dxf.match(/\n {2}0\nTEXT\n/g) ?? []).length).toBe(3);
    expect(dxf).toContain('#1  600×300');
    expect(dxf).toContain('#2  300×600');
    expect(dxf).toContain('Sheet 1/3 · White 18 · util 85.5%');
  });
});
