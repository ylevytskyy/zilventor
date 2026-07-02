// packages/app/src/drawing/__tests__/dxfWriter.xdata.spec.ts
import { describe, it, expect } from 'vitest';
import { createDxfDocument } from '../dxfWriter';

describe('dxfWriter — XDATA (DXF-XDATA)', () => {
  it('DXF-XDATA-1: registers a ZILVENTOR APPID alongside ACAD, table count bumped to 2', () => {
    const out = createDxfDocument().toString();
    const appidRecords = (out.match(/\n\s*0\nAPPID\n/g) ?? []).length;
    expect(appidRecords).toBe(2);
    expect(out).toMatch(
      /0\nAPPID\n\s*5\n[0-9A-F]+\n100\nAcDbSymbolTableRecord\n100\nAcDbRegAppTableRecord\n\s*2\nZILVENTOR\n/,
    );
    const headerMatch = /2\nAPPID\n\s*5\n[0-9A-F]+\n\s*70\n\s*(\d+)/.exec(out);
    expect(headerMatch, 'APPID TABLE header').not.toBeNull();
    expect(headerMatch![1]).toBe('2');
  });

  it('DXF-XDATA-2: circle() with xdata emits 1001 ZILVENTOR + typed codes (1070 int, 1040 real, 1000 string) AFTER the entity groups, in given order', () => {
    const doc = createDxfDocument();
    doc.circle('VISIBLE', 5, 5, 2, [
      { code: 1070, value: 3 },
      { code: 1040, value: 12000.5 },
      { code: 1000, value: 'note' },
    ]);
    const out = doc.toString();
    const circleIdx = out.indexOf('\nCIRCLE\n');
    const nextIdx = out.indexOf('\n  0\n', circleIdx + 1);
    const seg = out.slice(circleIdx, nextIdx === -1 ? out.length : nextIdx);

    const radiusPos = seg.indexOf(' 40');
    const appidPos = seg.indexOf('1001');
    const toolPos = seg.indexOf('1070');
    const speedPos = seg.indexOf('1040');
    const notePos = seg.indexOf('1000');

    expect(radiusPos).toBeGreaterThan(-1);
    expect(appidPos).toBeGreaterThan(radiusPos); // XDATA comes last, after regular groups
    expect(appidPos).toBeLessThan(toolPos);
    expect(toolPos).toBeLessThan(speedPos);
    expect(speedPos).toBeLessThan(notePos);

    expect(seg).toContain('1001\nZILVENTOR');
    expect(seg).toContain('1070\n3');
    expect(seg).toContain('1040\n12000.5000');
    expect(seg).toContain('1000\nnote');
  });

  it('DXF-XDATA-3: circle() without xdata emits no XDATA group (regression — pre-existing behavior unchanged)', () => {
    const doc = createDxfDocument();
    doc.circle('DETAIL', 15, 25, 7.5);
    const out = doc.toString();
    const circleIdx = out.indexOf('\nCIRCLE\n');
    const nextIdx = out.indexOf('\n  0\n', circleIdx + 1);
    const seg = out.slice(circleIdx, nextIdx === -1 ? out.length : nextIdx);
    expect(seg).not.toContain('1001');
    expect(out).not.toContain('ZILVENTOR\n1070');
  });

  it('DXF-XDATA-4: lwpolyline() with xdata emits exactly ONE 1001 ZILVENTOR block after all vertices, not per-vertex', () => {
    const doc = createDxfDocument();
    doc.lwpolyline(
      'VISIBLE',
      [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      true,
      [{ code: 1070, value: 7 }],
    );
    const out = doc.toString();
    const polyIdx = out.indexOf('\nLWPOLYLINE\n');
    const nextIdx = out.indexOf('\n  0\n', polyIdx + 1);
    const seg = out.slice(polyIdx, nextIdx === -1 ? out.length : nextIdx);

    const occurrences = (seg.match(/\n1001\n/g) ?? []).length;
    expect(occurrences).toBe(1);
    expect(seg).toContain('1070\n7');

    const lastVertexPos = seg.lastIndexOf(' 20');
    const xdataPos = seg.indexOf('1001');
    expect(xdataPos).toBeGreaterThan(lastVertexPos);
  });

  it('DXF-XDATA-5: lwpolyline() without xdata is unaffected (regression)', () => {
    const doc = createDxfDocument();
    doc.lwpolyline('VISIBLE', [{ x: 0, y: 0 }, { x: 10, y: 0 }], false);
    const out = doc.toString();
    expect(out).not.toContain('1001');
  });
});
