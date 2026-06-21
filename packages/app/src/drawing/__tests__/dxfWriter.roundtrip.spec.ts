// packages/app/src/drawing/__tests__/dxfWriter.roundtrip.spec.ts
import { describe, it, expect } from 'vitest';
import { createDxfDocument } from '../dxfWriter';
import { parseDxf } from '@zilventor/shared';

describe('writer → shared parser round-trip', () => {
  it('ARC round-trips with degrees preserved', () => {
    const doc = createDxfDocument();
    doc.arc('VISIBLE', 30, 40, 15, 45, 135);
    const e = parseDxf(doc.toString()).entities.find((x) => x.type === 'ARC');
    expect(e).toBeDefined();
    if (e && e.type === 'ARC') {
      expect([e.cx, e.cy, e.r]).toEqual([30, 40, 15]);
      expect(e.startAngle).toBeCloseTo(45);
      expect(e.endAngle).toBeCloseTo(135);
    }
  });

  it('ELLIPSE round-trips center/major/ratio', () => {
    const doc = createDxfDocument();
    doc.ellipse('VISIBLE', 5, 5, 10, 0, 0.5);
    const e = parseDxf(doc.toString()).entities.find((x) => x.type === 'ELLIPSE');
    expect(e).toBeDefined();
    if (e && e.type === 'ELLIPSE') {
      expect([e.cx, e.cy, e.majorX, e.majorY]).toEqual([5, 5, 10, 0]);
      expect(e.ratio).toBeCloseTo(0.5);
    }
  });

  it('SPLINE round-trips degree + control points', () => {
    const doc = createDxfDocument();
    doc.spline('VISIBLE', [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 3, y: 0 }], 2, false);
    const e = parseDxf(doc.toString()).entities.find((x) => x.type === 'SPLINE');
    expect(e).toBeDefined();
    if (e && e.type === 'SPLINE') {
      expect(e.degree).toBe(2);
      expect(e.controlPoints.map((p) => [p.x, p.y])).toEqual([[0, 0], [1, 2], [3, 0]]);
    }
  });

  it('LWPOLYLINE round-trips vertices + bulge + closed', () => {
    const doc = createDxfDocument();
    doc.lwpolyline('VISIBLE', [{ x: 0, y: 0, bulge: 0.5 }, { x: 10, y: 0 }, { x: 10, y: 10 }], true);
    const e = parseDxf(doc.toString()).entities.find((x) => x.type === 'LWPOLYLINE');
    expect(e).toBeDefined();
    if (e && e.type === 'LWPOLYLINE') {
      expect(e.closed).toBe(true);
      expect(e.vertices.map((v) => [v.x, v.y])).toEqual([[0, 0], [10, 0], [10, 10]]);
      expect(e.vertices[0]!.bulge).toBeCloseTo(0.5);
    }
  });

  it('LINE/CIRCLE/TEXT still round-trip after the strict upgrade', () => {
    const doc = createDxfDocument();
    doc.line('VISIBLE', 0, 0, 10, 10);
    doc.circle('VISIBLE', 5, 5, 2);
    doc.text('ANNOTATIONS', 1, 2, 3, 'Hi');
    const r = parseDxf(doc.toString());
    expect(r.entities.find((x) => x.type === 'LINE')).toBeDefined();
    expect(r.entities.find((x) => x.type === 'CIRCLE')).toBeDefined();
    expect(r.entities.find((x) => x.type === 'TEXT')).toBeDefined();
  });
});

describe('AC1015 strictness invariants', () => {
  it('every ENTITIES-section entity has AcDbEntity + a 330 owner + a unique handle', () => {
    const doc = createDxfDocument();
    doc.line('VISIBLE', 0, 0, 1, 1);
    doc.circle('VISIBLE', 0, 0, 1);
    doc.arc('VISIBLE', 0, 0, 1, 0, 90);
    const out = doc.toString();
    const entSec = out.slice(out.indexOf('\nENTITIES\n'), out.indexOf('\nOBJECTS\n'));
    // Each of the three entity types present with an AcDbEntity marker in the entities section
    expect((entSec.match(/AcDbEntity/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((entSec.match(/\n\s*330\n/g) ?? []).length).toBeGreaterThanOrEqual(3);
    // global handle uniqueness already covered in dxfWriter.ac1015.spec.ts
  });
});
