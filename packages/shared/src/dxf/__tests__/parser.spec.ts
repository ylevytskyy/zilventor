import { describe, it, expect } from 'vitest';
import { parseDxf } from '../parser';
import { tokenize as tk } from '../index';
import { parseDxf as pd } from '../index';

function entitiesDxf(body: string): string {
  return ['  0', 'SECTION', '  2', 'ENTITIES', body.trim(), '  0', 'ENDSEC', '  0', 'EOF'].join('\n');
}

describe('parseDxf — LINE & CIRCLE', () => {
  it('parses a LINE entity with endpoints and layer', () => {
    const dxf = entitiesDxf(['  0', 'LINE', '  8', 'VISIBLE',
      ' 10', '5.0', ' 20', '10.0', ' 30', '0.0',
      ' 11', '15.0', ' 21', '25.0', ' 31', '0.0'].join('\n'));
    const r = parseDxf(dxf);
    expect(r.entities).toHaveLength(1);
    const e = r.entities[0]!;
    expect(e.type).toBe('LINE');
    if (e.type === 'LINE') {
      expect(e.layer).toBe('VISIBLE');
      expect([e.x1, e.y1, e.x2, e.y2]).toEqual([5, 10, 15, 25]);
    }
  });

  it('parses a CIRCLE entity with center and radius', () => {
    const dxf = entitiesDxf(['  0', 'CIRCLE', '  8', '0',
      ' 10', '50.0', ' 20', '60.0', ' 30', '0.0', ' 40', '7.5'].join('\n'));
    const r = parseDxf(dxf);
    const e = r.entities[0]!;
    expect(e.type).toBe('CIRCLE');
    if (e.type === 'CIRCLE') expect([e.cx, e.cy, e.r]).toEqual([50, 60, 7.5]);
  });

  it('defaults missing layer to "0" and skips unknown entity types', () => {
    const dxf = entitiesDxf(['  0', 'HATCH', ' 10', '1.0',
      '  0', 'LINE', ' 10', '0.0', ' 20', '0.0', ' 11', '1.0', ' 21', '1.0'].join('\n'));
    const r = parseDxf(dxf);
    expect(r.entities).toHaveLength(1);
    expect(r.entities[0]!.type).toBe('LINE');
    expect(r.entities[0]!.layer).toBe('0');
  });

  it('never throws on malformed input', () => {
    expect(() => parseDxf('garbage @@@')).not.toThrow();
    expect(parseDxf('garbage @@@').entities).toEqual([]);
  });
});

describe('parseDxf — ARC, TEXT, MTEXT', () => {
  it('parses an ARC with angles preserved in DEGREES (no radian conversion)', () => {
    const dxf = entitiesDxf(['  0', 'ARC', '  8', '0',
      ' 10', '30.0', ' 20', '40.0', ' 40', '15.0', ' 50', '45.0', ' 51', '135.0'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('ARC');
    if (e.type === 'ARC') {
      expect([e.cx, e.cy, e.r]).toEqual([30, 40, 15]);
      expect(e.startAngle).toBeCloseTo(45);
      expect(e.endAngle).toBeCloseTo(135);
    }
  });

  it('parses a TEXT entity (value, height, rotation in degrees)', () => {
    const dxf = entitiesDxf(['  0', 'TEXT', '  8', '0',
      ' 10', '20.0', ' 20', '30.0', ' 40', '5.0', '  1', 'Hello', ' 50', '15.0'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('TEXT');
    if (e.type === 'TEXT') {
      expect([e.x, e.y, e.height]).toEqual([20, 30, 5]);
      expect(e.value).toBe('Hello');
      expect(e.rotation).toBeCloseTo(15);
    }
  });

  it('parses an MTEXT entity using group 40 for height', () => {
    const dxf = entitiesDxf(['  0', 'MTEXT', '  8', '0',
      ' 10', '1.0', ' 20', '2.0', ' 40', '3.0', '  1', 'Multi', ' 50', '0.0'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('MTEXT');
    if (e.type === 'MTEXT') {
      expect([e.x, e.y, e.height]).toEqual([1, 2, 3]);
      expect(e.value).toBe('Multi');
    }
  });
});

describe('parseDxf — polylines', () => {
  it('parses an open LWPOLYLINE with vertices and zero bulges', () => {
    const dxf = entitiesDxf(['  0', 'LWPOLYLINE', '  8', '0', ' 90', '3', ' 70', '0',
      ' 10', '0.0', ' 20', '0.0', ' 10', '10.0', ' 20', '0.0', ' 10', '10.0', ' 20', '10.0'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('LWPOLYLINE');
    if (e.type === 'LWPOLYLINE') {
      expect(e.closed).toBe(false);
      expect(e.vertices.map((v) => [v.x, v.y])).toEqual([[0, 0], [10, 0], [10, 10]]);
      expect(e.vertices.every((v) => v.bulge === 0)).toBe(true);
    }
  });

  it('captures per-vertex bulge on LWPOLYLINE and closed flag', () => {
    const dxf = entitiesDxf(['  0', 'LWPOLYLINE', '  8', '0', ' 70', '1',
      ' 10', '0.0', ' 20', '0.0', ' 42', '0.5', ' 10', '10.0', ' 20', '0.0'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('LWPOLYLINE');
    if (e.type === 'LWPOLYLINE') {
      expect(e.closed).toBe(true);
      expect(e.vertices[0]!.bulge).toBeCloseTo(0.5);
      expect(e.vertices[1]!.bulge).toBe(0);
    }
  });

  it('parses a legacy POLYLINE with VERTEX sub-entities and SEQEND', () => {
    const dxf = entitiesDxf(['  0', 'POLYLINE', '  8', '0', ' 70', '0',
      '  0', 'VERTEX', '  8', '0', ' 10', '1.0', ' 20', '2.0',
      '  0', 'VERTEX', '  8', '0', ' 10', '3.0', ' 20', '4.0', ' 42', '0.25',
      '  0', 'SEQEND', '  8', '0'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('POLYLINE');
    if (e.type === 'POLYLINE') {
      expect(e.vertices.map((v) => [v.x, v.y])).toEqual([[1, 2], [3, 4]]);
      expect(e.vertices[1]!.bulge).toBeCloseTo(0.25);
    }
  });
});

function blocksDxf(name: string, body: string, ix: number, iy: number): string {
  return ['  0', 'SECTION', '  2', 'BLOCKS',
    '  0', 'BLOCK', '  2', name, ' 70', '0', ' 10', '0.0', ' 20', '0.0',
    body.trim(),
    '  0', 'ENDBLK', '  0', 'ENDSEC',
    '  0', 'SECTION', '  2', 'ENTITIES',
    '  0', 'INSERT', '  2', name, ' 10', String(ix), ' 20', String(iy),
    '  0', 'ENDSEC', '  0', 'EOF'].join('\n');
}

describe('parseDxf — BLOCKS & INSERT', () => {
  it('collects block entities under blocks[name] and emits an INSERT record', () => {
    const dxf = blocksDxf('MYBLK',
      ['  0', 'LINE', '  8', '0', ' 10', '1.0', ' 20', '2.0', ' 11', '11.0', ' 21', '2.0'].join('\n'),
      100, 200);
    const r = parseDxf(dxf);
    expect(r.blocks['MYBLK']).toBeDefined();
    expect(r.blocks['MYBLK']!).toHaveLength(1);
    expect(r.blocks['MYBLK']![0]!.type).toBe('LINE');
    const ins = r.entities.find((e) => e.type === 'INSERT');
    expect(ins).toBeDefined();
    if (ins && ins.type === 'INSERT') {
      expect(ins.name).toBe('MYBLK');
      expect([ins.x, ins.y]).toEqual([100, 200]);
    }
  });
});

describe('parseDxf — SPLINE & ELLIPSE', () => {
  it('parses a SPLINE degree + control points + closed flag', () => {
    const dxf = entitiesDxf(['  0', 'SPLINE', '  8', '0', ' 70', '1', ' 71', '3',
      ' 10', '0.0', ' 20', '0.0', ' 10', '1.0', ' 20', '2.0', ' 10', '3.0', ' 20', '0.0'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('SPLINE');
    if (e.type === 'SPLINE') {
      expect(e.degree).toBe(3);
      expect(e.closed).toBe(true);
      expect(e.controlPoints.map((p) => [p.x, p.y])).toEqual([[0, 0], [1, 2], [3, 0]]);
    }
  });

  it('parses an ELLIPSE with center, major-axis vector, ratio, params', () => {
    const dxf = entitiesDxf(['  0', 'ELLIPSE', '  8', '0',
      ' 10', '5.0', ' 20', '5.0', ' 11', '10.0', ' 21', '0.0', ' 40', '0.5',
      ' 41', '0.0', ' 42', '6.283185'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('ELLIPSE');
    if (e.type === 'ELLIPSE') {
      expect([e.cx, e.cy]).toEqual([5, 5]);
      expect([e.majorX, e.majorY]).toEqual([10, 0]);
      expect(e.ratio).toBeCloseTo(0.5);
      expect(e.startParam).toBeCloseTo(0);
      expect(e.endParam).toBeCloseTo(6.283185);
    }
  });
});

describe('dxf barrel', () => {
  it('re-exports tokenize and parseDxf', () => {
    expect(typeof tk).toBe('function');
    expect(typeof pd).toBe('function');
  });
});
