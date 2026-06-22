import { describe, it, expect } from 'vitest';
import { parseDxf } from '../parser';
import { toSketch } from '../toSketch';

function ents(body: string, header = ''): string {
  return [header, '  0', 'SECTION', '  2', 'ENTITIES', body.trim(), '  0', 'ENDSEC', '  0', 'EOF'].join('\n');
}

describe('toSketch core mapping', () => {
  it('maps LINE → line with fresh id', () => {
    const r = toSketch(parseDxf(ents(['  0','LINE','  8','0',' 10','1',' 20','2',' 11','3',' 21','4'].join('\n'))));
    expect(r.primitives).toHaveLength(1);
    const p = r.primitives[0]!;
    expect(p.kind).toBe('line');
    if (p.kind === 'line') expect([p.x1, p.y1, p.x2, p.y2]).toEqual([1, 2, 3, 4]);
    expect(p.id).toMatch(/^dxf-/);
  });

  it('maps CIRCLE → circle', () => {
    const r = toSketch(parseDxf(ents(['  0','CIRCLE','  8','0',' 10','5',' 20','6',' 40','3'].join('\n'))));
    const p = r.primitives[0]!;
    if (p.kind === 'circle') expect([p.cx, p.cy, p.r]).toEqual([5, 6, 3]);
    else throw new Error('expected circle');
  });

  it('maps ARC degrees → radians', () => {
    // DXF arc 0°→90°
    const r = toSketch(parseDxf(ents(['  0','ARC','  8','0',' 10','0',' 20','0',' 40','2',' 50','0',' 51','90'].join('\n'))));
    const p = r.primitives[0]!;
    if (p.kind === 'arc') { expect(p.startAngle).toBeCloseTo(0, 9); expect(p.endAngle).toBeCloseTo(Math.PI / 2, 9); }
    else throw new Error('expected arc');
  });

  it('maps a full ELLIPSE → ellipse, omitting start/end angles', () => {
    // center (0,0), major endpoint (4,0) ⇒ rx=4, rotation=0; ratio 0.5 ⇒ ry=2; full 0→2π
    const r = toSketch(parseDxf(ents(['  0','ELLIPSE','  8','0',' 10','0',' 20','0',' 11','4',' 21','0',' 40','0.5',' 41','0',' 42','6.283185307179586'].join('\n'))));
    const p = r.primitives[0]!;
    if (p.kind === 'ellipse') {
      expect(p.rx).toBeCloseTo(4, 9); expect(p.ry).toBeCloseTo(2, 9); expect(p.rotation).toBeCloseTo(0, 9);
      expect('startAngle' in p ? p.startAngle : undefined).toBeUndefined();
    } else throw new Error('expected ellipse');
  });

  it('maps SPLINE control points → spline, degree clamped to poles-1', () => {
    const r = toSketch(parseDxf(ents(['  0','SPLINE','  8','0',' 71','3',' 10','0',' 20','0',' 10','5',' 20','5'].join('\n'))));
    const p = r.primitives[0]!;
    if (p.kind === 'spline') { expect(p.controlPoints).toHaveLength(2); expect(p.degree).toBe(1); } // 2 poles ⇒ clamp 3→1
    else throw new Error('expected spline');
  });

  it('falls back to SPLINE fit points when control points absent', () => {
    const r = toSketch(parseDxf(ents(['  0','SPLINE','  8','0',' 71','3',' 11','0',' 21','0',' 11','5',' 21','5',' 11','10',' 21','0'].join('\n'))));
    const p = r.primitives[0]!;
    if (p.kind === 'spline') expect(p.controlPoints).toHaveLength(3);
    else throw new Error('expected spline');
  });

  it('scales inch DXF ($INSUNITS=1) to mm', () => {
    const header = ['  0','SECTION','  2','HEADER','  9','$INSUNITS',' 70','1','  0','ENDSEC'].join('\n');
    const r = toSketch(parseDxf(ents(['  0','CIRCLE','  8','0',' 10','1',' 20','0',' 40','1'].join('\n'), header)));
    const p = r.primitives[0]!;
    if (p.kind === 'circle') { expect(p.cx).toBeCloseTo(25.4, 6); expect(p.r).toBeCloseTo(25.4, 6); }
    else throw new Error('expected circle');
  });

  it('tallies unsupported entities into dropped (e.g. INSERT)', () => {
    const r = toSketch(parseDxf(ents(['  0','INSERT','  8','0',' 10','0',' 20','0',' 66','0'].join('\n'))));
    expect(r.primitives).toHaveLength(0);
    expect(r.dropped.find((d) => d.kind === 'INSERT')?.count).toBe(1);
  });
});

describe('toSketch OCS→WCS', () => {
  it('mirrors a CIRCLE center across extrusion (0,0,-1)', () => {
    const dxf = ['  0','SECTION','  2','ENTITIES',
      '  0','CIRCLE','  8','0',' 10','5',' 20','7',' 40','3','210','0','220','0','230','-1',
      '  0','ENDSEC','  0','EOF'].join('\n');
    const p = toSketch(parseDxf(dxf)).primitives[0]!;
    if (p.kind === 'circle') { expect(p.cx).toBeCloseTo(-5, 9); expect(p.cy).toBeCloseTo(7, 9); expect(p.r).toBeCloseTo(3, 9); }
    else throw new Error('expected circle');
  });

  it('reflects an ARC: endpoints map correctly and sweep reverses', () => {
    // DXF arc center (0,0) r=2, 0°→90°. Under (0,0,-1): start point (2,0)→(-2,0) [angle π],
    // end point (0,2)→(0,2) [angle π/2]. CCW from π/2 to π traces the correct (upper-left) span.
    const dxf = ['  0','SECTION','  2','ENTITIES',
      '  0','ARC','  8','0',' 10','0',' 20','0',' 40','2',' 50','0',' 51','90','210','0','220','0','230','-1',
      '  0','ENDSEC','  0','EOF'].join('\n');
    const p = toSketch(parseDxf(dxf)).primitives[0]!;
    if (p.kind === 'arc') {
      // sample the CCW midpoint angle; it must lie in the upper-left quadrant (x<0, y>0)
      const mid = midAngleCCW(p.startAngle, p.endAngle);
      expect(Math.cos(mid)).toBeLessThan(0);
      expect(Math.sin(mid)).toBeGreaterThan(0);
    } else throw new Error('expected arc');
  });
});

function midAngleCCW(a: number, b: number): number {
  let span = b - a; while (span < 0) span += 2 * Math.PI;
  return a + span / 2;
}

describe('toSketch polyline + bulge', () => {
  it('maps a straight LWPOLYLINE (3 verts open) to 2 line segments', () => {
    const dxf = ['  0','SECTION','  2','ENTITIES',
      '  0','LWPOLYLINE','  8','0',' 90','3',' 70','0',
      ' 10','0',' 20','0',' 10','10',' 20','0',' 10','10',' 20','5',
      '  0','ENDSEC','  0','EOF'].join('\n');
    const r = toSketch(parseDxf(dxf));
    expect(r.primitives.filter((p) => p.kind === 'line')).toHaveLength(2);
  });

  it('maps a closed square LWPOLYLINE to 4 line segments (wrap included)', () => {
    const dxf = ['  0','SECTION','  2','ENTITIES',
      '  0','LWPOLYLINE','  8','0',' 90','4',' 70','1',
      ' 10','0',' 20','0',' 10','10',' 20','0',' 10','10',' 20','10',' 10','0',' 20','10',
      '  0','ENDSEC','  0','EOF'].join('\n');
    const r = toSketch(parseDxf(dxf));
    expect(r.primitives).toHaveLength(4);
    expect(r.primitives.every((p) => p.kind === 'line')).toBe(true);
  });

  it('maps a bulged segment to an arc on the correct side', () => {
    // segment (0,0)→(10,0) with bulge 0.41421356 (Δθ=90°). Arc must bulge UP (+y, left of travel).
    const dxf = ['  0','SECTION','  2','ENTITIES',
      '  0','LWPOLYLINE','  8','0',' 90','2',' 70','0',
      ' 10','0',' 20','0',' 42','0.41421356237',' 10','10',' 20','0',
      '  0','ENDSEC','  0','EOF'].join('\n');
    const r = toSketch(parseDxf(dxf));
    const arc = r.primitives.find((p) => p.kind === 'arc');
    expect(arc).toBeDefined();
    if (arc && arc.kind === 'arc') {
      // center sits below the chord (bulge-opposite side)
      expect(arc.cy).toBeLessThan(0);
      // the CCW-mid point of the arc lies above the chord (y>0)
      let span = arc.endAngle - arc.startAngle; while (span < 0) span += 2 * Math.PI;
      const mid = arc.startAngle + span / 2;
      expect(arc.cy + arc.r * Math.sin(mid)).toBeGreaterThan(0);
    }
  });

  it('negates bulge sign under reflected OCS (extrusion 0,0,-1)', () => {
    // Derivation: extrusion (0,0,-1) → ocsReflected=true; ocsXY maps (x,y)→(-x,y).
    // chord (0,0)→(10,0) in OCS maps to (0,0)→(-10,0) in WCS.
    // Without fix: bulge=+0.41421356 on reflected chord → arc mid-point at -y (wrong side).
    // With fix: bulge negated to -0.41421356 on chord (0,0)→(-10,0) → arc mid-point at +y (correct WCS side,
    //   matching the geometry a viewer would expect from the original CCW arc mirrored across the y-axis).
    const dxf = ['  0','SECTION','  2','ENTITIES',
      '  0','LWPOLYLINE','  8','0',' 90','2',' 70','0',
      ' 10','0',' 20','0',' 42','0.41421356237',' 10','10',' 20','0',
      '210','0','220','0','230','-1',
      '  0','ENDSEC','  0','EOF'].join('\n');
    const r = toSketch(parseDxf(dxf));
    const arc = r.primitives.find((p) => p.kind === 'arc');
    expect(arc).toBeDefined();
    if (arc && arc.kind === 'arc') {
      // The CCW-mid point of the emitted arc must lie above the WCS chord (y>0), matching the
      // non-reflected case geometry seen from the front (+z) direction.
      const mid = midAngleCCW(arc.startAngle, arc.endAngle);
      expect(arc.cy + arc.r * Math.sin(mid)).toBeGreaterThan(0);
    }
  });
});

describe('toSketch Phase 4b coverage', () => {
  it('maps POINT → point primitive (unit-scaled)', () => {
    const header = ['  0','SECTION','  2','HEADER','  9','$INSUNITS',' 70','1','  0','ENDSEC'].join('\n');
    const r = toSketch(parseDxf(ents(['  0','POINT','  8','0',' 10','2',' 20','3'].join('\n'), header)));
    const p = r.primitives[0]!;
    if (p.kind === 'point') { expect(p.x).toBeCloseTo(50.8, 6); expect(p.y).toBeCloseTo(76.2, 6); }
    else throw new Error('expected point');
  });
});

describe('toSketch Phase 4b layer→construction', () => {
  it('marks entities on DEFPOINTS / frozen layers as construction', () => {
    const tables = ['  0','SECTION','  2','TABLES','  0','TABLE','  2','LAYER',
      '  0','LAYER','  2','DEFPOINTS','  6','CONTINUOUS',' 62','7',' 70','0',
      '  0','LAYER','  2','FROZ','  6','CONTINUOUS',' 62','7',' 70','1',
      '  0','LAYER','  2','NORMAL','  6','CONTINUOUS',' 62','7',' 70','0',
      '  0','ENDTAB','  0','ENDSEC'].join('\n');
    const body = ['  0','CIRCLE','  8','DEFPOINTS',' 10','0',' 20','0',' 40','1',
      '  0','CIRCLE','  8','FROZ',' 10','5',' 20','0',' 40','1',
      '  0','CIRCLE','  8','NORMAL',' 10','9',' 20','0',' 40','1'].join('\n');
    const dxf = [tables,'  0','SECTION','  2','ENTITIES',body,'  0','ENDSEC','  0','EOF'].join('\n');
    const ps = toSketch(parseDxf(dxf)).primitives;
    expect(ps[0]!.construction).toBe(true);   // DEFPOINTS
    expect(ps[1]!.construction).toBe(true);   // frozen
    expect(ps[2]!.construction).toBeUndefined(); // normal layer
  });
});

describe('toSketch Phase 4a coverage', () => {
  it('passes through trimmed ellipse startAngle/endAngle unscaled even when units scale coordinates', () => {
    // $INSUNITS=1 (inch→mm, ×25.4). rx must be scaled; startAngle/endAngle must be raw radians.
    const header = ['  0','SECTION','  2','HEADER','  9','$INSUNITS',' 70','1','  0','ENDSEC'].join('\n');
    const r = toSketch(parseDxf(ents(
      ['  0','ELLIPSE','  8','0',' 10','0',' 20','0',' 11','1',' 21','0',' 40','0.5',' 41','0.5',' 42','2.0'].join('\n'),
      header,
    )));
    const p = r.primitives[0]!;
    if (p.kind === 'ellipse') {
      // rx = majorLen * scale = 1 * 25.4 = 25.4
      expect(p.rx).toBeCloseTo(25.4, 6);
      // startAngle and endAngle are raw radians from DXF, NOT scaled
      expect('startAngle' in p ? p.startAngle : undefined).toBeCloseTo(0.5, 9);
      expect('endAngle' in p ? p.endAngle : undefined).toBeCloseTo(2.0, 9);
    } else throw new Error('expected ellipse');
  });

  it('drops a SPLINE with fewer than 2 control or fit points', () => {
    // Single control point — toSketch must drop it and not emit a spline primitive.
    const r = toSketch(parseDxf(ents(
      ['  0','SPLINE','  8','0',' 71','3',' 10','0',' 20','0'].join('\n'),
    )));
    expect(r.primitives.some((p) => p.kind === 'spline')).toBe(false);
    const splineDropped = r.dropped.find((d) => d.kind === 'SPLINE');
    expect(splineDropped).toBeDefined();
    expect((splineDropped?.count ?? 0)).toBeGreaterThanOrEqual(1);
  });

  it('scales a CIRCLE by ×10 for $INSUNITS=5 (centimetres)', () => {
    const header = ['  0','SECTION','  2','HEADER','  9','$INSUNITS',' 70','5','  0','ENDSEC'].join('\n');
    const r = toSketch(parseDxf(ents(
      ['  0','CIRCLE','  8','0',' 10','1',' 20','0',' 40','1'].join('\n'),
      header,
    )));
    const p = r.primitives[0]!;
    if (p.kind === 'circle') {
      expect(p.cx).toBeCloseTo(10, 6);
      expect(p.r).toBeCloseTo(10, 6);
    } else throw new Error('expected circle');
  });
});

describe('toSketch INSERT flatten', () => {
  const BLOCK_DXF = (insert: string): string => ['  0','SECTION','  2','BLOCKS',
    '  0','BLOCK','  8','0','  2','BLK',' 70','0',' 10','0',' 20','0','  3','BLK',
    '  0','LINE','  8','0',' 10','0',' 20','0',' 11','2',' 21','0',
    '  0','ENDBLK','  0','ENDSEC',
    '  0','SECTION','  2','ENTITIES', insert, '  0','ENDSEC','  0','EOF'].join('\n');

  it('flattens a single INSERT with translation', () => {
    const r = toSketch(parseDxf(BLOCK_DXF(['  0','INSERT','  2','BLK',' 10','10',' 20','5',' 41','1',' 42','1',' 50','0'].join('\n'))));
    const line = r.primitives.find((p) => p.kind === 'line');
    expect(line).toBeDefined();
    if (line && line.kind === 'line') { expect([line.x1, line.y1]).toEqual([10, 5]); expect([line.x2, line.y2]).toEqual([12, 5]); }
  });

  it('expands a 2×1 INSERT array', () => {
    const r = toSketch(parseDxf(BLOCK_DXF(['  0','INSERT','  2','BLK',' 10','0',' 20','0',' 41','1',' 42','1',' 50','0',
      ' 70','2',' 71','1',' 44','20',' 45','0'].join('\n'))));
    expect(r.primitives.filter((p) => p.kind === 'line')).toHaveLength(2); // 2 columns
    const xs = r.primitives.filter((p) => p.kind === 'line').map((p) => (p as { x1: number }).x1).sort((a, b) => a - b);
    expect(xs).toEqual([0, 20]); // second copy offset by colSpacing
  });
});
