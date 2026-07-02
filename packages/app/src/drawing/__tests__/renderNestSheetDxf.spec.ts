import { describe, it, expect } from 'vitest';
import { renderNestSheetDxf } from '../renderNestSheetDxf';
import type { NestSheet } from '@zilventor/shared';
import { parseDxf } from '@zilventor/shared';

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
  sheetIndex: 1,
  sheetLengthMm: 2800,
  sheetWidthMm: 2070,
  utilizationPct: 85.5,
  panels: [
    { itemNumber: 1, rowKey: 'a', x: 10, y: 20, length: 600, width: 300, rotated: false, grain: 'none' },
    { itemNumber: 2, rowKey: 'b', x: 700, y: 20, length: 300, width: 600, rotated: true, grain: 'none' },
  ],
};

// Extract every LINE as { layer, x1, y1, x2, y2} — format-agnostic (parseFloat).
function lines(dxf: string): Array<{ layer: string; x1: number; y1: number; x2: number; y2: number }> {
  const raw = dxf.split('\n');
  const out: Array<{ layer: string; x1: number; y1: number; x2: number; y2: number }> = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '  0' && raw[i + 1] === 'LINE') {
      let layer = '';
      let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
      for (let j = i + 2; j < raw.length; j++) {
        if (raw[j] === '  0') break;
        if (raw[j] === '  8') layer = raw[j + 1]!;
        if (raw[j] === ' 10') x1 = parseFloat(raw[j + 1]!);
        if (raw[j] === ' 20') y1 = parseFloat(raw[j + 1]!);
        if (raw[j] === ' 11') x2 = parseFloat(raw[j + 1]!);
        if (raw[j] === ' 21') y2 = parseFloat(raw[j + 1]!);
      }
      out.push({ layer, x1, y1, x2, y2 });
    }
  }
  return out;
}

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
    expect(dxf).toContain('#1  600x300');
    expect(dxf).toContain('#2  300x600');
    expect(dxf).toContain('Sheet 1/3 - White 18 - util 85.5%');
  });

  it('emits no GRAIN geometry for grain=none panels', () => {
    const dxf = renderNestSheetDxf(sheet, { sheetCount: 3, materialName: 'White 18' });
    expect(lines(dxf).some((l) => l.layer === 'GRAIN')).toBe(false);
  });

  it('rotates the GRAIN annotation by exactly 90° for a panel nested rotated', () => {
    const grainSheet: NestSheet = {
      materialId: 'mdf18',
      sheetIndex: 1,
      sheetLengthMm: 2800,
      sheetWidthMm: 2070,
      utilizationPct: 50,
      panels: [
        // Original grain='length', placed unrotated: 600 long (X) x 300 wide (Y).
        { itemNumber: 1, rowKey: 'a', x: 0, y: 0, length: 600, width: 300, rotated: false, grain: 'length' },
        // Same original grain='length', but nested rotated 90°: post-rotation extents
        // swapped (300 along X, 600 along Y) — the grain axis must follow the material.
        { itemNumber: 2, rowKey: 'b', x: 1000, y: 0, length: 300, width: 600, rotated: true, grain: 'length' },
      ],
    };
    const dxf = renderNestSheetDxf(grainSheet, { sheetCount: 1, materialName: 'White 18' });
    const grainLines = lines(dxf).filter((l) => l.layer === 'GRAIN');
    expect(grainLines.length).toBeGreaterThan(0);

    // Group by panel (panel 1 near x=0..600, panel 2 near x=1000..1300); within each
    // group the "main" grain line is the longest segment (arrowhead ticks are short).
    const angleOfMainLine = (group: typeof grainLines): number => {
      const main = group.reduce((best, l) => {
        const len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
        const bestLen = Math.hypot(best.x2 - best.x1, best.y2 - best.y1);
        return len > bestLen ? l : best;
      });
      return Math.atan2(main.y2 - main.y1, main.x2 - main.x1) * (180 / Math.PI);
    };
    const panel1Lines = grainLines.filter((l) => l.x1 < 700 && l.x2 < 700);
    const panel2Lines = grainLines.filter((l) => l.x1 >= 700 && l.x2 >= 700);
    expect(panel1Lines.length).toBeGreaterThan(0);
    expect(panel2Lines.length).toBeGreaterThan(0);

    const angle1 = angleOfMainLine(panel1Lines);
    const angle2 = angleOfMainLine(panel2Lines);
    // Normalize both angles to [0, 180) so a line and its reverse compare equal.
    const norm = (a: number): number => ((a % 180) + 180) % 180;
    const diff = Math.abs(norm(angle1) - norm(angle2));
    expect(Math.min(diff, 180 - diff)).toBeCloseTo(90, 5);
  });
});

// R4.3 (docs/abf-plugin/05-parity/03-processing-parity-requirements.md lines 73-90): lock
// DXF fidelity via real parsing rather than regex. Current-state finding (as of commit
// eb13a307, which added the GRAIN layer): nest-sheet DXF still carries zero circular/hole
// geometry — only SHEET/OUTLINE lwpolylines, GRAIN lines, and INFO text. So there is nothing
// to assert as CIRCLE/ARC here; instead we lock that no LWPOLYLINE in the output approximates
// a circle (heuristic: no closed polyline with more than 4 vertices — rectangles only).
describe('renderNestSheetDxf — DXF fidelity (parse-based)', () => {
  it('emits no closed LWPOLYLINE with more than 4 vertices anywhere (no polyline circles)', () => {
    const dxf = renderNestSheetDxf(sheet, { sheetCount: 3, materialName: 'White 18' });
    const parsed = parseDxf(dxf);
    const closedPolys = parsed.entities.filter((e) => e.type === 'LWPOLYLINE' && e.closed);
    expect(closedPolys.length).toBeGreaterThan(0);
    expect(closedPolys.every((e) => e.type === 'LWPOLYLINE' && e.vertices.length <= 4)).toBe(true);
  });
});
