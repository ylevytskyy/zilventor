import { describe, it, expect } from 'vitest';
import { renderCombinedNestDxf } from '../renderNestSheetDxf';
import type { NestSheet } from '@zilventor/shared';
import { parseDxf } from '@zilventor/shared';
import { layoutCombinedGrid } from '../layoutCombinedGrid';

const sheetA: NestSheet = {
  materialId: 'mdf18',
  sheetIndex: 1,
  sheetLengthMm: 2800,
  sheetWidthMm: 2070,
  utilizationPct: 85.5,
  panels: [
    { itemNumber: 1, rowKey: 'a', x: 10, y: 20, length: 600, width: 300, rotated: false, grain: 'none' },
  ],
};

const sheetB: NestSheet = {
  materialId: 'ply12',
  sheetIndex: 1,
  sheetLengthMm: 1200,
  sheetWidthMm: 900,
  utilizationPct: 40,
  panels: [
    { itemNumber: 2, rowKey: 'b', x: 0, y: 0, length: 500, width: 400, rotated: false, grain: 'length' },
  ],
};

function outlines(dxf: string, layer: string): Array<{ minX: number; minY: number; w: number; h: number }> {
  const parsed = parseDxf(dxf);
  return parsed.entities
    .filter((e) => e.type === 'LWPOLYLINE' && e.layer === layer)
    .map((e) => {
      const verts = (e as { vertices: Array<{ x: number; y: number }> }).vertices;
      const xs = verts.map((v) => v.x);
      const ys = verts.map((v) => v.y);
      return { minX: Math.min(...xs), minY: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    });
}

function layerTableNames(dxf: string): string[] {
  const lines = dxf.split('\n');
  const names: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '  0' && lines[i + 1] === 'LAYER') {
      for (let j = i + 2; j < lines.length; j++) {
        if (lines[j] === '  0') break;
        if (lines[j] === '  2') { names.push(lines[j + 1]!); break; }
      }
    }
  }
  return names;
}

describe('renderCombinedNestDxf', () => {
  it('parses as one valid DXF document containing all sheets and panels', () => {
    const dxf = renderCombinedNestDxf([sheetA, sheetB], { materialNames: { mdf18: 'MDF 18', ply12: 'Ply 12' } });
    const parsed = parseDxf(dxf);
    expect(parsed.entities.length).toBeGreaterThan(0);
  });

  it('places N sheet boundaries at the exact layoutCombinedGrid offsets', () => {
    const sheets = [sheetA, sheetB];
    const dxf = renderCombinedNestDxf(sheets, { materialNames: { mdf18: 'MDF 18', ply12: 'Ply 12' } });
    const expectedOffsets = layoutCombinedGrid(
      sheets.map((s) => ({ width: s.sheetLengthMm, height: s.sheetWidthMm })),
      50,
    );
    const sheetOutlines = outlines(dxf, 'SHEET');
    expect(sheetOutlines).toHaveLength(2);
    sheets.forEach((sheet, i) => {
      const off = expectedOffsets[i]!;
      expect(sheetOutlines).toContainEqual({ minX: off.x, minY: off.y, w: sheet.sheetLengthMm, h: sheet.sheetWidthMm });
    });
  });

  it('translates each sheet\'s panels by the same offset as its sheet boundary', () => {
    const sheets = [sheetA, sheetB];
    const dxf = renderCombinedNestDxf(sheets, { materialNames: { mdf18: 'MDF 18', ply12: 'Ply 12' } });
    const expectedOffsets = layoutCombinedGrid(
      sheets.map((s) => ({ width: s.sheetLengthMm, height: s.sheetWidthMm })),
      50,
    );
    const panelOutlines = outlines(dxf, 'OUTLINE');
    expect(panelOutlines).toContainEqual({
      minX: sheetA.panels[0]!.x + expectedOffsets[0]!.x,
      minY: sheetA.panels[0]!.y + expectedOffsets[0]!.y,
      w: sheetA.panels[0]!.length, h: sheetA.panels[0]!.width,
    });
    expect(panelOutlines).toContainEqual({
      minX: sheetB.panels[0]!.x + expectedOffsets[1]!.x,
      minY: sheetB.panels[0]!.y + expectedOffsets[1]!.y,
      w: sheetB.panels[0]!.length, h: sheetB.panels[0]!.width,
    });
  });

  it('each sheet keeps its own header INFO label with its own material name', () => {
    const dxf = renderCombinedNestDxf([sheetA, sheetB], { materialNames: { mdf18: 'MDF 18', ply12: 'Ply 12' } });
    expect(dxf).toContain('MDF 18');
    expect(dxf).toContain('Ply 12');
  });

  it('LAYER table is a deduped union: SHEET/OUTLINE/INFO always, GRAIN only when a panel needs it, each exactly once', () => {
    const dxf = renderCombinedNestDxf([sheetA, sheetB], { materialNames: { mdf18: 'MDF 18', ply12: 'Ply 12' } });
    const names = layerTableNames(dxf);
    expect(names.length).toBe(new Set(names).size);
    expect(names).toContain('SHEET');
    expect(names).toContain('OUTLINE');
    expect(names).toContain('INFO');
    expect(names).toContain('GRAIN'); // sheetB has a grain='length' panel
  });

  it('omits the GRAIN layer entirely when no sheet has a grained panel', () => {
    const noGrainSheet: NestSheet = { ...sheetB, panels: [{ ...sheetB.panels[0]!, grain: 'none' }] };
    const dxf = renderCombinedNestDxf([sheetA, noGrainSheet], { materialNames: { mdf18: 'MDF 18', ply12: 'Ply 12' } });
    expect(layerTableNames(dxf)).not.toContain('GRAIN');
  });
});
