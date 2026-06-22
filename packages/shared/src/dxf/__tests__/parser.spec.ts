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
    const dxf = entitiesDxf(['  0', 'VIEWPORT', ' 10', '1.0',
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
      expect(e.rotation).toBeCloseTo(0);
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
      expect(ins.xscale).toBe(1);
      expect(ins.yscale).toBe(1);
      expect(ins.rotation).toBe(0);
      expect(ins.layer).toBe('0');
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

function headerDxf(body: string): string {
  return ['  0', 'SECTION', '  2', 'HEADER', body.trim(), '  0', 'ENDSEC', '  0', 'EOF'].join('\n');
}

describe('parseDxf HEADER section', () => {
  it('captures $INSUNITS and $ACADVER from the HEADER section', () => {
    const dxf = headerDxf([
      '  9', '$ACADVER', '  1', 'AC1015',
      '  9', '$INSUNITS', ' 70', '4',
      '  9', '$EXTMIN', ' 10', '0.0', ' 20', '0.0', ' 30', '0.0',
    ].join('\n'));
    const r = parseDxf(dxf);
    expect(r.header['$ACADVER']).toBe('AC1015');
    expect(r.header['$INSUNITS']).toBe('4');
    expect(r.header['$EXTMIN']).toBe('0.0'); // first value pair after the var name
  });
});

describe('parseDxf SPLINE fidelity', () => {
  it('reads fit points and knots when control points are absent', () => {
    const dxf = ['  0','SECTION','  2','ENTITIES',
      '  0','SPLINE','  8','0',' 71','3',
      ' 40','0',' 40','0',' 40','1',' 40','1',
      ' 11','0',' 21','0',' 11','5',' 21','5',' 11','10',' 21','0',
      '  0','ENDSEC','  0','EOF'].join('\n');
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('SPLINE');
    if (e.type === 'SPLINE') {
      expect(e.controlPoints).toHaveLength(0);
      expect(e.fitPoints).toEqual([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }]);
      expect(e.knots).toEqual([0, 0, 1, 1]);
    }
  });
});

describe('parseDxf OCS extrusion', () => {
  it('reads extrusion (0,0,-1) on a CIRCLE', () => {
    const dxf = ['  0','SECTION','  2','ENTITIES',
      '  0','CIRCLE','  8','0',' 10','5.0',' 20','5.0',' 40','3.0',
      '210','0.0','220','0.0','230','-1.0',
      '  0','ENDSEC','  0','EOF'].join('\n');
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('CIRCLE');
    if (e.type === 'CIRCLE') expect(e.extrusion).toEqual({ x: 0, y: 0, z: -1 });
  });
  it('leaves extrusion undefined when 210/220/230 absent', () => {
    const dxf = ['  0','SECTION','  2','ENTITIES',
      '  0','CIRCLE','  8','0',' 10','1',' 20','1',' 40','2',
      '  0','ENDSEC','  0','EOF'].join('\n');
    const e = parseDxf(dxf).entities[0]!;
    if (e.type === 'CIRCLE') expect(e.extrusion).toBeUndefined();
  });
});

describe('parseDxf TABLES/LAYER', () => {
  it('captures LAYER records (name/color/linetype/flags)', () => {
    const dxf = ['  0','SECTION','  2','TABLES',
      '  0','TABLE','  2','LAYER',
      '  0','LAYER','  2','0','  6','CONTINUOUS',' 62','7',' 70','0',
      '  0','LAYER','  2','DEFPOINTS','  6','CONTINUOUS',' 62','7',' 70','1',
      '  0','ENDTAB','  0','ENDSEC','  0','EOF'].join('\n');
    const r = parseDxf(dxf);
    expect(Object.keys(r.layers)).toEqual(['0', 'DEFPOINTS']);
    expect(r.layers['DEFPOINTS']).toEqual({ name: 'DEFPOINTS', color: 7, linetype: 'CONTINUOUS', flags: 1 });
  });
  it('leaves layers empty when no TABLES section', () => {
    const dxf = ['  0','SECTION','  2','ENTITIES','  0','LINE','  8','0',' 10','0',' 20','0',' 11','1',' 21','1',
      '  0','ENDSEC','  0','EOF'].join('\n');
    expect(parseDxf(dxf).layers).toEqual({});
  });
});

describe('parseDxf INSERT arrays + BLOCK base points', () => {
  it('reads COLUMNS/ROWS/spacing on an INSERT (defaults to 1/1/0/0)', () => {
    const dxf = ['  0','SECTION','  2','ENTITIES',
      '  0','INSERT','  2','BLK',' 10','1',' 20','2',' 41','1',' 42','1',' 50','0',
      ' 70','3',' 71','2',' 44','10',' 45','20',
      '  0','ENDSEC','  0','EOF'].join('\n');
    const e = parseDxf(dxf).entities[0]!;
    if (e.type === 'INSERT') {
      expect([e.columns, e.rows, e.colSpacing, e.rowSpacing]).toEqual([3, 2, 10, 20]);
    } else throw new Error('expected INSERT');
  });
  it('defaults columns/rows to 1 when absent', () => {
    const dxf = ['  0','SECTION','  2','ENTITIES',
      '  0','INSERT','  2','BLK',' 10','0',' 20','0',
      '  0','ENDSEC','  0','EOF'].join('\n');
    const e = parseDxf(dxf).entities[0]!;
    if (e.type === 'INSERT') expect([e.columns, e.rows]).toEqual([1, 1]);
    else throw new Error('expected INSERT');
  });
  it('captures a BLOCK base point', () => {
    const dxf = ['  0','SECTION','  2','BLOCKS',
      '  0','BLOCK','  8','0','  2','BLK',' 70','0',' 10','5',' 20','7',' 30','0','  3','BLK',
      '  0','LINE','  8','0',' 10','0',' 20','0',' 11','1',' 21','1',
      '  0','ENDBLK',
      '  0','ENDSEC','  0','EOF'].join('\n');
    const r = parseDxf(dxf);
    expect(r.blocks['BLK']).toHaveLength(1);
    expect(r.blockBasePoints['BLK']).toEqual({ x: 5, y: 7 });
  });
});

describe('parseDxf — LEADER', () => {
  it('parses leader vertices from repeated 10/20 pairs', () => {
    const dxf = entitiesDxf(['  0', 'LEADER', '  8', 'NOTES', ' 76', '3',
      ' 10', '0', ' 20', '0',
      ' 10', '5', ' 20', '5',
      ' 10', '10', ' 20', '5'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('LEADER');
    if (e.type === 'LEADER') {
      expect(e.vertices.map((v) => [v.x, v.y])).toEqual([[0, 0], [5, 5], [10, 5]]);
    }
  });
});

describe('parseDxf — DIMENSION', () => {
  it('parses block name, text override, measurement, and text midpoint', () => {
    const dxf = entitiesDxf(['  0', 'DIMENSION', '  8', 'DIMENSIONS',
      '  2', '*D1', '  1', '<>', ' 42', '123.45',
      ' 11', '50', ' 21', '60'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('DIMENSION');
    if (e.type === 'DIMENSION') {
      expect(e.block).toBe('*D1');
      expect(e.textOverride).toBe('<>');
      expect(e.measurement).toBeCloseTo(123.45);
      expect([e.textMidX, e.textMidY]).toEqual([50, 60]);
    }
  });

  it('omits block when group 2 is absent', () => {
    const dxf = entitiesDxf(['  0', 'DIMENSION', '  8', '0',
      ' 42', '10', ' 11', '1', ' 21', '2'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('DIMENSION');
    if (e.type === 'DIMENSION') expect(e.block).toBeUndefined();
  });
});

describe('parseDxf — MLEADER', () => {
  it('extracts one leader line and embedded mtext from CONTEXT_DATA', () => {
    const dxf = entitiesDxf(['  0', 'MLEADER', '  8', '0',
      '300', 'CONTEXT_DATA{',
      '290', '1',          // has_mtext_content
      '304', 'Note A',     // mtext content (NOT ending in '{', so it is content not a token)
      ' 12', '20', ' 22', '30',  // text location
      ' 41', '2.5',        // text height
      ' 42', '0',          // text rotation
      '302', 'LEADER{',
      '304', 'LEADER_LINE{',
      ' 10', '0', ' 20', '0',
      ' 10', '5', ' 20', '5',
      '305', '}',
      '303', '}',
      '301', '}'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('MLEADER');
    if (e.type === 'MLEADER') {
      expect(e.leaderLines).toHaveLength(1);
      expect(e.leaderLines[0]!.map((v) => [v.x, v.y])).toEqual([[0, 0], [5, 5]]);
      expect(e.text?.value).toBe('Note A');
      expect([e.text?.x, e.text?.y]).toEqual([20, 30]);
      expect(e.text?.height).toBeCloseTo(2.5);
    }
  });

  it('returns an empty MLEADER for malformed/empty content (no throw)', () => {
    const dxf = entitiesDxf(['  0', 'MLEADER', '  8', '0',
      '300', 'CONTEXT_DATA{', '290', '0', '301', '}'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('MLEADER');
    if (e.type === 'MLEADER') {
      expect(e.leaderLines).toHaveLength(0);
      expect(e.text).toBeUndefined();
    }
  });
});

describe('parseDxf — SOLID', () => {
  it('parses a quad SOLID in winding order P0,P1,P3,P2', () => {
    const dxf = entitiesDxf(['  0', 'SOLID', '  8', 'ARROWS',
      ' 10', '0', ' 20', '0',
      ' 11', '1', ' 21', '0',
      ' 12', '0', ' 22', '1',
      ' 13', '1', ' 23', '1'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('SOLID');
    if (e.type === 'SOLID') {
      // stored 10,11,12,13 = (0,0),(1,0),(0,1),(1,1); winding order is 10,11,13,12
      expect(e.corners.map((c) => [c.x, c.y])).toEqual([[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
  });

  it('collapses a triangle when corner 12 == corner 13', () => {
    const dxf = entitiesDxf(['  0', 'SOLID', '  8', '0',
      ' 10', '0', ' 20', '0',
      ' 11', '2', ' 21', '0',
      ' 12', '1', ' 22', '2',
      ' 13', '1', ' 23', '2'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('SOLID');
    if (e.type === 'SOLID') expect(e.corners.map((c) => [c.x, c.y])).toEqual([[0, 0], [2, 0], [1, 2]]);
  });
});

describe('parseDxf — 3DFACE', () => {
  it('parses a quad 3DFACE with four 3D corners in sequential order', () => {
    const dxf = entitiesDxf(['  0', '3DFACE', '  8', '0',
      ' 10', '0', ' 20', '0', ' 30', '0',
      ' 11', '1', ' 21', '0', ' 31', '0',
      ' 12', '1', ' 22', '1', ' 32', '0',
      ' 13', '0', ' 23', '1', ' 33', '0'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('3DFACE');
    if (e.type === '3DFACE') {
      expect(e.corners).toHaveLength(4);
      expect(e.corners[0]).toEqual({ x: 0, y: 0, z: 0 });
      expect(e.corners[2]).toEqual({ x: 1, y: 1, z: 0 });
    }
  });

  it('collapses to a triangle when corner 3 equals corner 2', () => {
    const dxf = entitiesDxf(['  0', '3DFACE', '  8', '0',
      ' 10', '0', ' 20', '0', ' 30', '0',
      ' 11', '2', ' 21', '0', ' 31', '0',
      ' 12', '1', ' 22', '2', ' 32', '0',
      ' 13', '1', ' 23', '2', ' 33', '0'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('3DFACE');
    if (e.type === '3DFACE') expect(e.corners).toHaveLength(3);
  });
});

describe('parseDxf — RAY & XLINE', () => {
  it('parses a RAY with base point and direction (z dropped)', () => {
    const dxf = entitiesDxf(['  0', 'RAY', '  8', '0',
      ' 10', '1', ' 20', '2', ' 30', '0', ' 11', '1', ' 21', '0', ' 31', '0'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('RAY');
    if (e.type === 'RAY') expect([e.x, e.y, e.dx, e.dy]).toEqual([1, 2, 1, 0]);
  });

  it('parses an XLINE with base point and direction', () => {
    const dxf = entitiesDxf(['  0', 'XLINE', '  8', '0',
      ' 10', '0', ' 20', '0', ' 11', '0', ' 21', '1'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('XLINE');
    if (e.type === 'XLINE') expect([e.x, e.y, e.dx, e.dy]).toEqual([0, 0, 0, 1]);
  });
});

describe('parseDxf — HATCH', () => {
  it('parses a HATCH with a single closed polyline boundary loop (with bulge)', () => {
    const dxf = entitiesDxf([
      '  0', 'HATCH', '  8', 'H',
      ' 91', '1',                              // 1 boundary path
      ' 92', '3',                              // path type: bit1 (external) + bit2 (polyline) = 3
      ' 72', '1',                              // has bulge
      ' 73', '1',                              // is closed
      ' 93', '3',                              // 3 vertices
      ' 10', '0', ' 20', '0', ' 42', '0',
      ' 10', '10', ' 20', '0', ' 42', '0.5',
      ' 10', '10', ' 20', '10', ' 42', '0',
      ' 97', '0',                              // 0 source objects (boundary section ends)
    ].join('\n'));
    const r = parseDxf(dxf);
    expect(r.entities).toHaveLength(1);
    const e = r.entities[0]!;
    expect(e.type).toBe('HATCH');
    if (e.type === 'HATCH') {
      expect(e.layer).toBe('H');
      expect(e.loops).toHaveLength(1);
      const loop = e.loops[0]!;
      expect(loop.kind).toBe('polyline');
      if (loop.kind === 'polyline') {
        expect(loop.closed).toBe(true);
        expect(loop.vertices).toHaveLength(3);
        expect(loop.vertices[0]).toEqual({ x: 0, y: 0, bulge: 0 });
        expect(loop.vertices[1]).toEqual({ x: 10, y: 0, bulge: 0.5 });
        expect(loop.vertices[2]).toEqual({ x: 10, y: 10, bulge: 0 });
      }
    }
  });
});
