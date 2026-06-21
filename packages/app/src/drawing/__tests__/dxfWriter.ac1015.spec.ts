// packages/app/src/drawing/__tests__/dxfWriter.ac1015.spec.ts
import { describe, it, expect } from 'vitest';
import { createDxfDocument } from '../dxfWriter';

describe('dxfWriter AC1015 header', () => {
  it('declares AC1015 and a numeric $HANDSEED greater than every entity handle', () => {
    const doc = createDxfDocument();
    doc.line('VISIBLE', 0, 0, 10, 10);
    doc.circle('VISIBLE', 5, 5, 2);
    const out = doc.toString();

    expect(out).toContain('$ACADVER');
    expect(out).toContain('AC1015');
    expect(out).not.toContain('AC1009');

    // $HANDSEED present
    const seedMatch = /\$HANDSEED\n\s*5\n\s*([0-9A-F]+)/.exec(out);
    expect(seedMatch, 'has $HANDSEED').not.toBeNull();
    const seed = parseInt(seedMatch![1]!, 16);

    // Scan only the ENTITIES section for group-5 handles — the $HANDSEED line
    // itself uses group code 5 and would otherwise appear in the scan, causing
    // seed < seed to fail. HEADER is before ENTITIES so slicing from ENTITIES is safe.
    const entitiesSection = out.slice(out.indexOf('\nENTITIES\n'));
    const handles = [...entitiesSection.matchAll(/\n\s*5\n\s*([0-9A-F]+)/g)].map(
      (m) => parseInt(m[1]!, 16),
    );
    expect(handles.length).toBeGreaterThan(0);
    expect(new Set(handles).size).toBe(handles.length); // unique
    for (const h of handles) expect(h).toBeLessThan(seed);
  });

  it('emits an OBJECTS section with a root DICTIONARY', () => {
    const out = createDxfDocument().toString();
    expect(out).toMatch(/\n\s*2\nOBJECTS\n/);
    expect(out).toContain('DICTIONARY');
  });
});

describe('dxfWriter AC1015 tables', () => {
  it('emits the required AC1015 tables incl APPID ACAD and BLOCK_RECORD model/paper space', () => {
    const out = createDxfDocument().toString();
    for (const t of ['VPORT', 'LTYPE', 'LAYER', 'STYLE', 'VIEW', 'UCS', 'APPID', 'DIMSTYLE', 'BLOCK_RECORD']) {
      expect(out, `table ${t}`).toContain(t);
    }
    expect(out).toContain('ACAD');          // APPID record
    expect(out).toContain('*Model_Space');
    expect(out).toContain('*Paper_Space');
  });

  it('gives every LAYER record a handle', () => {
    const out = createDxfDocument().toString();
    // VISIBLE layer record followed (within a few lines) by a group-5 handle
    const layerBlock = out.slice(out.indexOf('LAYER'));
    expect(/\n\s*0\nLAYER\n\s*5\n\s*[0-9A-F]+/.test(layerBlock)).toBe(true);
  });
});

describe('dxfWriter AC1015 entity subclass markers', () => {
  it('LINE carries AcDbEntity + AcDbLine + a 330 owner', () => {
    const doc = createDxfDocument();
    doc.line('VISIBLE', 0, 0, 10, 10);
    const out = doc.toString();
    expect(out).toContain('AcDbLine');
    // the LINE entity block contains AcDbEntity, a 330 owner, and AcDbLine
    const lineSeg = out.slice(out.indexOf('\nLINE\n'));
    expect(lineSeg).toContain('AcDbEntity');
    expect(/\n\s*330\n/.test(lineSeg)).toBe(true);
  });

  it('CIRCLE→AcDbCircle, TEXT→AcDbText, POLYLINE→AcDb2dPolyline', () => {
    const doc = createDxfDocument();
    doc.circle('VISIBLE', 1, 1, 2);
    doc.text('ANNOTATIONS', 0, 0, 3, 'Hi');
    doc.polyline('VISIBLE', [[0, 0], [1, 1], [2, 0]]);
    const out = doc.toString();
    expect(out).toContain('AcDbCircle');
    expect(out).toContain('AcDbText');
    expect(out).toContain('AcDb2dPolyline');
    expect(out).toContain('AcDbVertex');
  });
});

describe('dxfWriter arc()', () => {
  it('emits a native ARC entity with center/radius/angles in degrees', () => {
    const doc = createDxfDocument();
    doc.arc('VISIBLE', 30, 40, 15, 45, 135);
    const out = doc.toString();
    expect(out).toContain('\nARC\n');
    expect(out).toContain('AcDbArc');
    const seg = out.slice(out.indexOf('\nARC\n'));
    expect(seg).toMatch(/\n\s*50\n\s*45\.0000/);  // start angle deg
    expect(seg).toMatch(/\n\s*51\n\s*135\.0000/); // end angle deg
  });
});

describe('dxfWriter ellipse()', () => {
  it('emits a native ELLIPSE with center, major-axis vector, ratio, params', () => {
    const doc = createDxfDocument();
    doc.ellipse('VISIBLE', 5, 5, 10, 0, 0.5);
    const out = doc.toString();
    expect(out).toContain('\nELLIPSE\n');
    expect(out).toContain('AcDbEllipse');
    const seg = out.slice(out.indexOf('\nELLIPSE\n'));
    expect(seg).toMatch(/\n\s*40\n\s*0\.5000/);              // ratio
    expect(seg).toMatch(/\n\s*42\n\s*6\.2832/);              // default endParam 2π (toFixed(4) rounds up)
  });
});

describe('dxfWriter spline()', () => {
  it('emits a native SPLINE with degree, control points, and a knot vector', () => {
    const doc = createDxfDocument();
    doc.spline('VISIBLE', [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 3, y: 0 }], 2, false);
    const out = doc.toString();
    expect(out).toContain('\nSPLINE\n');
    expect(out).toContain('AcDbSpline');
    const seg = out.slice(out.indexOf('\nSPLINE\n'));
    expect(seg).toMatch(/\n\s*71\n\s*2/);  // degree 2
    expect(seg).toMatch(/\n\s*73\n\s*3/);  // 3 control points
    expect((seg.match(/\n\s*40\n/g) ?? []).length).toBeGreaterThanOrEqual(1); // knots present
  });
});
