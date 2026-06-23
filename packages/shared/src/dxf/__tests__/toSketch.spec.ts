import { describe, it, expect } from 'vitest';
import { parseDxf } from '../parser';
import { toSketch } from '../toSketch';
import { transformEllipse, transformPrimitive, ellipseAxes } from '../toSketch';
import type { ParsedDxf } from '../types';

describe('ellipseAxes', () => {
  it('ellipseAxes computes rx/ry/rotation from a mapped major endpoint', () => {
    // major endpoint (3,4) → length 5; ratio 0.5 → ry 2.5; rotation atan2(4,3); unit scale 2 → rx 10, ry 5
    const { rx, ry, rotation } = ellipseAxes(3, 4, 0.5, 2);
    expect(rx).toBeCloseTo(10, 9);
    expect(ry).toBeCloseTo(5, 9);
    expect(rotation).toBeCloseTo(Math.atan2(4, 3), 9);
  });
});

describe('transformEllipse', () => {
  // Pure 90° CCW rotation about origin: M = [[0,-1,0],[1,0,0]] (a=0,b=1,c=-1,d=0,e=0,f=0)
  const rot90: { a: number; b: number; c: number; d: number; e: number; f: number } =
    { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 };

  it('rotates a circular arc: center and params move by +90°, stays isotropic', () => {
    const r = transformEllipse(rot90, 3, 4, 2, 2, 0, Math.PI / 6, (2 * Math.PI) / 3);
    expect(r.cx).toBeCloseTo(-4, 9);
    expect(r.cy).toBeCloseTo(3, 9);
    expect(r.rx).toBeCloseTo(2, 9);
    expect(r.ry).toBeCloseTo(2, 9);
    expect(r.isotropic).toBe(true);
    // principal-frame params + the returned rotation reconstruct the TRUE angles 2π/3 and 7π/6
    expect(r.startAngle! + r.rotation).toBeCloseTo((2 * Math.PI) / 3, 6);
    expect(r.endAngle! + r.rotation).toBeCloseTo((7 * Math.PI) / 6, 6);
  });

  it('non-uniform scale of a circle yields an axis-aligned ellipse', () => {
    // M = scale(2,1): a=2,d=1
    const m = { a: 2, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const r = transformEllipse(m, 0, 0, 3, 3, 0);
    expect(r.isotropic).toBe(false);
    expect(r.rx).toBeCloseTo(6, 9); // 3*2
    expect(r.ry).toBeCloseTo(3, 9); // 3*1
    expect(r.rotation).toBeCloseTo(0, 9);
  });

  it('reflection (negative x-scale) swaps start/end of an arc', () => {
    // M = scale(-1,1): mirror across Y axis. det = -1 < 0.
    const m = { a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const r = transformEllipse(m, 0, 0, 2, 2, 0, 0, Math.PI / 2);
    // start point (2,0) -> (-2,0) true angle π ; end point (0,2)->(0,2) true angle π/2
    // reflected => swap so emitted start is the old end-image, end is old start-image
    expect(r.isotropic).toBe(true);
    expect(r.startAngle! + r.rotation).toBeCloseTo(Math.PI / 2, 6);
    expect(r.endAngle! + r.rotation).toBeCloseTo(Math.PI, 6);
  });

  it('degenerate zero-scale INSERT does not produce NaN', () => {
    // xscale=0 collapses the curve: det = 0*d - 0 = 0
    const m = { a: 0, b: 0, c: 0, d: 1, e: 5, f: 7 };
    const r = transformEllipse(m, 1, 2, 3, 3, 0, 0, Math.PI / 2);
    expect(Number.isNaN(r.startAngle!)).toBe(false);
    expect(Number.isNaN(r.endAngle!)).toBe(false);
    expect(Number.isNaN(r.rx)).toBe(false);
    expect(Number.isNaN(r.ry)).toBe(false);
    // center is still mapped by the affine translation
    expect(r.cx).toBeCloseTo(0 + 5, 9);  // a*1+c*2+e = 0+0+5
    expect(r.cy).toBeCloseTo(2 + 7, 9);  // b*1+d*2+f = 0+2+7
    // original radii preserved (no Rytz)
    expect(r.rx).toBeCloseTo(3, 9);
    expect(r.ry).toBeCloseTo(3, 9);
  });
});

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

describe('toSketch POINT OCS (4c)', () => {
  it('mirrors a POINT under extrusion (0,0,-1)', () => {
    const dxf = ['  0','SECTION','  2','ENTITIES',
      '  0','POINT','  8','0',' 10','5',' 20','7','210','0','220','0','230','-1',
      '  0','ENDSEC','  0','EOF'].join('\n');
    const p = toSketch(parseDxf(dxf)).primitives[0]!;
    expect(p.kind).toBe('point');
    if (p.kind === 'point') {
      expect(p.x).toBeCloseTo(-5, 9);
      expect(p.y).toBeCloseTo(7, 9);
    } else throw new Error('expected point');
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

  it('applies 2-column array offset in local frame before rotation (rotation=90°)', () => {
    // $INSUNITS=4 (mm, scale factor=1, so unit-scale s=1 — coords match block values directly).
    // Block BLK: line from (0,0) to (5,0) in block space. Base point (0,0).
    // INSERT at (0,0), rotation=90°, xscale=yscale=1, columns=2, rows=1, colSpacing=10, rowSpacing=0.
    //
    // Copy 1 (cI=0, rI=0): local offset dx=0, dy=0 → WCS offset (0,0). Placed at (0,0).
    //   Matrix = T(0,0) ∘ R(90°) ∘ S(1,1) ∘ T(-base(0,0)).
    //   line start (0,0) → rotate 90° → (0,0) → translate (0,0) → WCS (0,0).
    //   line end   (5,0) → rotate 90°: (cos90°·5−sin90°·0, sin90°·5+cos90°·0) = (0,5) → WCS (0,5).
    //
    // Copy 2 (cI=1, rI=0): local offset dx=10, dy=0.
    //   Rotated into WCS: offWCS.x = cos90°·10 − sin90°·0 = 0,
    //                     offWCS.y = sin90°·10 + cos90°·0 = 10.
    //   Placed insertion point: (0+0, 0+10) = (0,10).
    //   line start (0,0) → rotate 90° → (0,0) → translate (0,10) → WCS (0,10).
    //   line end   (5,0) → rotate 90° → (0,5) → translate (0,10) → WCS (0,15).
    //
    // Old WCS-offset code (bug): placed copy 2 at ins.x+10=10, ins.y=0.
    //   line start → WCS (10,0), line end → WCS (10,5). WRONG for rotated insert.
    const header = ['  0','SECTION','  2','HEADER','  9','$INSUNITS',' 70','4','  0','ENDSEC'].join('\n');
    const blocks = ['  0','SECTION','  2','BLOCKS',
      '  0','BLOCK','  8','0','  2','BLK',' 70','0',' 10','0',' 20','0','  3','BLK',
      '  0','LINE','  8','0',' 10','0',' 20','0',' 11','5',' 21','0',
      '  0','ENDBLK','  0','ENDSEC'].join('\n');
    const entities = ['  0','SECTION','  2','ENTITIES',
      // INSERT: pos=(0,0), xscale=1, yscale=1, rotation=90 (deg), columns=2, rows=1, colSpacing=10, rowSpacing=0
      '  0','INSERT','  2','BLK',' 10','0',' 20','0',' 41','1',' 42','1',' 50','90',
      ' 70','2',' 71','1',' 44','10',' 45','0',
      '  0','ENDSEC','  0','EOF'].join('\n');
    const dxf = [header, blocks, entities].join('\n');
    const r = toSketch(parseDxf(dxf));
    const lines = r.primitives.filter((p) => p.kind === 'line');
    expect(lines).toHaveLength(2);
    // Sort by start-y so copy1 (y1≈0) comes first, copy2 (y1≈10) second.
    const sorted = [...lines].sort((a, b) => (a as { y1: number }).y1 - (b as { y1: number }).y1);
    type LLine = { kind: 'line'; x1: number; y1: number; x2: number; y2: number };
    const copy1 = sorted[0] as LLine, copy2 = sorted[1] as LLine;
    // Copy 1: line rotated 90° at origin — start (0,0), end (0,5).
    expect(copy1.x1).toBeCloseTo(0, 9);
    expect(copy1.y1).toBeCloseTo(0, 9);
    expect(copy1.x2).toBeCloseTo(0, 9);
    expect(copy1.y2).toBeCloseTo(5, 9);
    // Copy 2: local-frame offset (10,0) rotated 90° → WCS (0,10) → insertion at (0,10).
    // Old WCS-offset code (bug) would give start (10,0), end (10,5) — distinct failure.
    expect(copy2.x1).toBeCloseTo(0, 9);
    expect(copy2.y1).toBeCloseTo(10, 9);
    expect(copy2.x2).toBeCloseTo(0, 9);
    expect(copy2.y2).toBeCloseTo(15, 9);
  });
});

describe('ellipse branch-cut normalization', () => {
  // (a) Plain trimmed ELLIPSE whose CCW arc crosses the 2π param seam.
  //   center (0,0), major endpoint (4,0) ⇒ rx=4, rotation=0; ratio 0.5 ⇒ ry=2.
  //   startParam=5.5 (≈315°), endParam=0.5 (≈29°). The CORRECT CCW (increasing-param)
  //   short arc sweeps 5.5 → 0.5+2π = 6.783, i.e. span 1.283 rad (< π) across the 2π seam.
  //   mapEntity emits raw start/end ⇒ endAngle(0.5) < startAngle(5.5) today (BUG).
  //   Post-fix invariant: endAngle ≥ startAngle (and the arc is the short one, span < π).
  it('plain trimmed ELLIPSE crossing 2π seam has endAngle ≥ startAngle', () => {
    const r = toSketch(parseDxf(ents(
      ['  0','ELLIPSE','  8','0',' 10','0',' 20','0',' 11','4',' 21','0',' 40','0.5',' 41','5.5',' 42','0.5'].join('\n'),
    )));
    const p = r.primitives[0]!;
    if (p.kind !== 'ellipse') throw new Error('expected ellipse');
    expect(p.startAngle).toBeDefined();
    expect(p.endAngle).toBeDefined();
    // desired post-fix invariant — FAILS today (endAngle 0.5 < startAngle 5.5)
    expect(p.endAngle!).toBeGreaterThanOrEqual(p.startAngle!);
    // and it must remain the SHORT arc (≈1.283 rad), not the complementary one
    expect(p.endAngle! - p.startAngle!).toBeLessThan(Math.PI);
  });

  // (b) Same kind of trimmed ellipse under an INSERT, so it flows through
  //   transformPrimitive → transformEllipse(mapParam, atan2-based) → buildCurveFromEllipse
  //   non-isotropic branch (which omits the arc branch's CCW while-loop).
  //   Axis-aligned ellipse (rx=4, ry=2, rotation 0), startParam=2.5 (≈143°), endParam=3.8 (≈218°).
  //   The CCW short arc 2.5→3.8 (span 1.3 rad < π) straddles the +π atan2 seam.
  //   Under a unit-scale, unrotated INSERT, mapParam returns the param wrapped to (-π,π]:
  //     mapParam(2.5)=2.5,  mapParam(3.8)=3.8−2π≈−2.483.
  //   ⇒ startAngle 2.5, endAngle −2.483 ⇒ endAngle < startAngle today (BUG).
  it('trimmed ELLIPSE under INSERT crossing π seam has endAngle ≥ startAngle', () => {
    const blocks = [
      '  0','SECTION','  2','BLOCKS',
      '  0','BLOCK','  8','0','  2','ELB',' 70','0',' 10','0',' 20','0','  3','ELB',
      // ELLIPSE: center (0,0), major endpoint (4,0), ratio 0.5, startParam 2.5, endParam 3.8
      '  0','ELLIPSE','  8','0',' 10','0',' 20','0',' 11','4',' 21','0',' 40','0.5',' 41','2.5',' 42','3.8',
      '  0','ENDBLK','  0','ENDSEC',
    ].join('\n');
    const entities = [
      '  0','SECTION','  2','ENTITIES',
      // INSERT: pos=(0,0), xscale=1, yscale=1, rotation=0
      '  0','INSERT','  2','ELB',' 10','0',' 20','0',' 41','1',' 42','1',' 50','0',
      '  0','ENDSEC','  0','EOF',
    ].join('\n');
    const r = toSketch(parseDxf([blocks, entities].join('\n')));
    const p = r.primitives.find((q) => q.kind === 'ellipse');
    if (!p || p.kind !== 'ellipse') throw new Error('expected ellipse');
    expect(p.startAngle).toBeDefined();
    expect(p.endAngle).toBeDefined();
    // desired post-fix invariant — FAILS today (endAngle ≈ −2.483 < startAngle 2.5)
    expect(p.endAngle!).toBeGreaterThanOrEqual(p.startAngle!);
    // and it must remain the SHORT arc (≈1.3 rad), not the complementary one
    expect(p.endAngle! - p.startAngle!).toBeLessThan(Math.PI);
  });
});

describe('toSketch INSERT arc-angle under rotated INSERT (4c)', () => {
  it('rotates arc start/end angles under a 90° rotated INSERT', () => {
    const blocks = [
      '  0','SECTION','  2','BLOCKS',
      '  0','BLOCK','  8','0','  2','BLK2',' 70','0',' 10','0',' 20','0','  3','BLK2',
      // ARC: center (3,4), r=2, startAngle=30°, endAngle=120°
      '  0','ARC','  8','0',' 10','3',' 20','4',' 40','2',' 50','30',' 51','120',
      '  0','ENDBLK','  0','ENDSEC',
    ].join('\n');
    const entities = [
      '  0','SECTION','  2','ENTITIES',
      // INSERT: pos=(0,0), xscale=1, yscale=1, rotation=90°
      '  0','INSERT','  2','BLK2',' 10','0',' 20','0',' 41','1',' 42','1',' 50','90',
      '  0','ENDSEC','  0','EOF',
    ].join('\n');
    const dxf = [blocks, entities].join('\n');
    const r = toSketch(parseDxf(dxf));
    const arc = r.primitives.find((p) => p.kind === 'arc');
    expect(arc).toBeDefined();
    if (!arc || arc.kind !== 'arc') throw new Error('expected arc');
    // Center rotates (3,4) -> (-4,3); angles rotate +90°.
    expect(arc.kind).toBe('arc');
    expect(arc.cx).toBeCloseTo(-4, 9);
    expect(arc.cy).toBeCloseTo(3, 9);
    expect(arc.startAngle).toBeCloseTo((2 * Math.PI) / 3, 6);   // 30°+90° = 120°
    expect(arc.endAngle).toBeCloseTo((7 * Math.PI) / 6, 6);     // 120°+90° = 210°
  });
});

describe('transformPrimitive curves (4c)', () => {
  const rot90 = { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 };
  const scale21 = { a: 2, b: 0, c: 0, d: 1, e: 0, f: 0 };

  it('circle under non-uniform scale becomes an axis-aligned ellipse', () => {
    const out = transformPrimitive(scale21, { id: 'c1', kind: 'circle', cx: 0, cy: 0, r: 3 });
    expect(out.kind).toBe('ellipse');
    if (out.kind === 'ellipse') {
      expect(out.rx).toBeCloseTo(6, 9);
      expect(out.ry).toBeCloseTo(3, 9);
      expect(out.rotation).toBeCloseTo(0, 9);
      expect(out.startAngle).toBeUndefined();
    }
  });

  it('circle under pure rotation stays a circle', () => {
    const out = transformPrimitive(rot90, { id: 'c2', kind: 'circle', cx: 1, cy: 0, r: 2 });
    expect(out.kind).toBe('circle');
    if (out.kind === 'circle') {
      expect(out.cx).toBeCloseTo(0, 9);
      expect(out.cy).toBeCloseTo(1, 9);
      expect(out.r).toBeCloseTo(2, 9);
    }
  });

  it('preserves construction flag through the transform', () => {
    const out = transformPrimitive(rot90, { id: 'c3', kind: 'circle', cx: 1, cy: 0, r: 2, construction: true });
    expect(out.construction).toBe(true);
  });
});

describe('toSketch — SOLID', () => {
  it('maps a quad SOLID to a closed loop of 4 construction lines', () => {
    const r = toSketch(parseDxf(ents(['  0', 'SOLID', '  8', '0',
      ' 10', '0', ' 20', '0', ' 11', '1', ' 21', '0',
      ' 12', '0', ' 22', '1', ' 13', '1', ' 23', '1'].join('\n'))));
    expect(r.primitives).toHaveLength(4);
    expect(r.primitives.every((p) => p.kind === 'line' && p.construction === true)).toBe(true);
    // closed: last segment ends back at first corner (0,0)
    const last = r.primitives[3]!;
    if (last.kind === 'line') expect([last.x2, last.y2]).toEqual([0, 0]);
  });

  it('maps a triangle SOLID to 3 lines', () => {
    const r = toSketch(parseDxf(ents(['  0', 'SOLID', '  8', '0',
      ' 10', '0', ' 20', '0', ' 11', '2', ' 21', '0',
      ' 12', '1', ' 22', '2', ' 13', '1', ' 23', '2'].join('\n'))));
    expect(r.primitives).toHaveLength(3);
  });
});

describe('toSketch TEXT/MTEXT → annotations', () => {
  it('maps TEXT to a text annotation (deg→rad rotation, unit-scaled)', () => {
    const header = ['  0','SECTION','  2','HEADER','  9','$INSUNITS',' 70','4','  0','ENDSEC'].join('\n');
    const r = toSketch(parseDxf(ents(['  0','TEXT','  8','0',' 10','1',' 20','2',' 40','5',' 1','HELLO',' 50','90'].join('\n'), header)));
    expect(r.primitives).toHaveLength(0);
    expect(r.annotations).toHaveLength(1);
    const a = r.annotations[0]!;
    expect([a.x, a.y, a.height, a.value]).toEqual([1, 2, 5, 'HELLO']);
    expect(a.rotation).toBeCloseTo(Math.PI / 2, 9);
  });
  it('strips MTEXT inline formatting codes', () => {
    const r = toSketch(parseDxf(ents(['  0','MTEXT','  8','0',' 10','0',' 20','0',' 40','2',' 1','{\\fArial|b0;Line1}\\PLine2',' 50','0'].join('\n'))));
    expect(r.annotations[0]!.value).toBe('Line1\nLine2');
  });
});

describe('toSketch — LEADER', () => {
  it('maps a 3-vertex LEADER to 2 construction segments, no annotation', () => {
    const r = toSketch(parseDxf(ents(['  0', 'LEADER', '  8', '0',
      ' 10', '0', ' 20', '0', ' 10', '5', ' 20', '5', ' 10', '10', ' 20', '5'].join('\n'))));
    expect(r.primitives).toHaveLength(2);
    expect(r.primitives.every((p) => p.kind === 'line' && p.construction === true)).toBe(true);
    expect(r.annotations).toHaveLength(0);
  });

  it('drops a degenerate LEADER (< 2 vertices)', () => {
    const r = toSketch(parseDxf(ents(['  0', 'LEADER', '  8', '0', ' 10', '1', ' 20', '1'].join('\n'))));
    expect(r.primitives).toHaveLength(0);
    expect(r.dropped.some((d) => d.kind === 'LEADER')).toBe(true);
  });
});

describe('toSketch — expandInsert flattens SOLID in block body', () => {
  it('renders a block SOLID arrowhead as construction lines', () => {
    const parsed: ParsedDxf = {
      entities: [{ type: 'INSERT', layer: '0', name: 'ARROW', x: 0, y: 0,
        xscale: 1, yscale: 1, rotation: 0, columns: 1, rows: 1, colSpacing: 0, rowSpacing: 0 }],
      blocks: {
        ARROW: [{ type: 'SOLID', layer: '0',
          corners: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }],
      },
      header: {}, layers: {}, blockBasePoints: { ARROW: { x: 0, y: 0 } },
    };
    const r = toSketch(parsed);
    expect(r.primitives).toHaveLength(4);
    expect(r.primitives.every((p) => p.kind === 'line' && p.construction === true)).toBe(true);
  });
});

describe('toSketch — DIMENSION', () => {
  it('full fidelity: flattens block geometry + arrowhead and emits the block MTEXT', () => {
    const parsed: ParsedDxf = {
      entities: [{ type: 'DIMENSION', layer: 'DIMENSIONS', block: '*D1',
        textOverride: '<>', measurement: 100, textMidX: 5, textMidY: 1 }],
      blocks: {
        '*D1': [
          { type: 'LINE', layer: '0', x1: 0, y1: 0, x2: 10, y2: 0 },
          { type: 'SOLID', layer: '0', corners: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
          { type: 'MTEXT', layer: '0', x: 5, y: 1, height: 2.5, value: '100', rotation: 0 },
        ],
      },
      header: {}, layers: {}, blockBasePoints: { '*D1': { x: 0, y: 0 } },
    };
    const r = toSketch(parsed);
    // 1 dimension line + 4 arrowhead-loop lines = 5 primitives
    expect(r.primitives.filter((p) => p.kind === 'line')).toHaveLength(5);
    expect(r.annotations).toHaveLength(1);
    expect(r.annotations[0]!.value).toBe('100');
    expect([r.annotations[0]!.x, r.annotations[0]!.y]).toEqual([5, 1]);
  });

  it('fallback: no block → single annotation with formatted measurement at text mid', () => {
    const parsed: ParsedDxf = {
      entities: [{ type: 'DIMENSION', layer: '0',
        textOverride: '<>', measurement: 123.5, textMidX: 7, textMidY: 8 }],
      blocks: {}, header: {}, layers: {}, blockBasePoints: {},
    };
    const r = toSketch(parsed);
    expect(r.primitives).toHaveLength(0);
    expect(r.annotations).toHaveLength(1);
    expect(r.annotations[0]!.value).toBe('123.5');
    expect([r.annotations[0]!.x, r.annotations[0]!.y]).toEqual([7, 8]);
  });

  it('fallback: non-empty override wins over measurement', () => {
    const parsed: ParsedDxf = {
      entities: [{ type: 'DIMENSION', layer: '0',
        textOverride: 'TYP.', measurement: 50, textMidX: 0, textMidY: 0 }],
      blocks: {}, header: {}, layers: {}, blockBasePoints: {},
    };
    expect(toSketch(parsed).annotations[0]!.value).toBe('TYP.');
  });
});

describe('toSketch — MLEADER', () => {
  it('maps one leader line + embedded mtext', () => {
    const r = toSketch(parseDxf(ents(['  0', 'MLEADER', '  8', '0',
      '300', 'CONTEXT_DATA{', '290', '1', '304', 'Hi', ' 12', '9', ' 22', '9', ' 41', '2', ' 42', '0',
      '302', 'LEADER{', '304', 'LEADER_LINE{', ' 10', '0', ' 20', '0', ' 10', '4', ' 20', '4',
      '305', '}', '303', '}', '301', '}'].join('\n'))));
    expect(r.primitives).toHaveLength(1);
    expect(r.primitives[0]!.kind === 'line' && r.primitives[0]!.construction === true).toBe(true);
    expect(r.annotations).toHaveLength(1);
    expect(r.annotations[0]!.value).toBe('Hi');
  });

  it('drops an empty MLEADER without crashing', () => {
    const r = toSketch(parseDxf(ents(['  0', 'MLEADER', '  8', '0',
      '300', 'CONTEXT_DATA{', '290', '0', '301', '}'].join('\n'))));
    expect(r.primitives).toHaveLength(0);
    expect(r.annotations).toHaveLength(0);
    expect(r.dropped.some((d) => d.kind === 'MLEADER')).toBe(true);
  });
});

describe('toSketch — 3DFACE', () => {
  it('maps a planar quad 3DFACE to a closed loop of 4 construction lines', () => {
    const r = toSketch(parseDxf(ents(['  0', '3DFACE', '  8', '0',
      ' 10', '0', ' 20', '0', ' 30', '0',
      ' 11', '1', ' 21', '0', ' 31', '0',
      ' 12', '1', ' 22', '1', ' 32', '0',
      ' 13', '0', ' 23', '1', ' 33', '0'].join('\n'))));
    expect(r.primitives).toHaveLength(4);
    expect(r.primitives.every((p) => p.kind === 'line' && p.construction === true)).toBe(true);
    const last = r.primitives[3]!;
    if (last.kind === 'line') expect([last.x2, last.y2]).toEqual([0, 0]); // closed back to c0
  });

  it('maps a planar triangle 3DFACE to 3 lines', () => {
    const r = toSketch(parseDxf(ents(['  0', '3DFACE', '  8', '0',
      ' 10', '0', ' 20', '0', ' 30', '0',
      ' 11', '2', ' 21', '0', ' 31', '0',
      ' 12', '1', ' 22', '2', ' 32', '0',
      ' 13', '1', ' 23', '2', ' 33', '0'].join('\n'))));
    expect(r.primitives).toHaveLength(3);
  });

  it('imports a face flat at a nonzero single z plane', () => {
    const r = toSketch(parseDxf(ents(['  0', '3DFACE', '  8', '0',
      ' 10', '0', ' 20', '0', ' 30', '5',
      ' 11', '1', ' 21', '0', ' 31', '5',
      ' 12', '1', ' 22', '1', ' 32', '5',
      ' 13', '0', ' 23', '1', ' 33', '5'].join('\n'))));
    expect(r.primitives).toHaveLength(4);
  });

  it('drops a non-planar 3DFACE (corners not co-Z) and tallies it', () => {
    const r = toSketch(parseDxf(ents(['  0', '3DFACE', '  8', '0',
      ' 10', '0', ' 20', '0', ' 30', '0',
      ' 11', '1', ' 21', '0', ' 31', '0',
      ' 12', '1', ' 22', '1', ' 32', '9',
      ' 13', '0', ' 23', '1', ' 33', '0'].join('\n'))));
    expect(r.primitives).toHaveLength(0);
    expect(r.dropped.some((d) => d.kind === '3DFACE')).toBe(true);
  });

  it('flattens a 3DFACE inside an INSERT block', () => {
    const parsed: ParsedDxf = {
      entities: [{ type: 'INSERT', layer: '0', name: 'FACE', x: 0, y: 0,
        xscale: 1, yscale: 1, rotation: 0, columns: 1, rows: 1, colSpacing: 0, rowSpacing: 0 }],
      blocks: {
        FACE: [{ type: '3DFACE', layer: '0',
          corners: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }] }],
      },
      header: {}, layers: {}, blockBasePoints: { FACE: { x: 0, y: 0 } },
    };
    const r = toSketch(parsed);
    expect(r.primitives).toHaveLength(4);
    expect(r.primitives.every((p) => p.kind === 'line' && p.construction === true)).toBe(true);
  });
});

describe('toSketch — RAY/XLINE bbox-clamp', () => {
  it('clamps an XLINE to span the geometry bounding box', () => {
    // Circle r=5 at origin → bbox [-5,-5]..[5,5]; horizontal XLINE through y=0.
    const r = toSketch(parseDxf(ents([
      '  0', 'CIRCLE', '  8', '0', ' 10', '0', ' 20', '0', ' 40', '5',
      '  0', 'XLINE', '  8', '0', ' 10', '0', ' 20', '0', ' 11', '1', ' 21', '0',
    ].join('\n'))));
    const line = r.primitives.find((p) => p.kind === 'line');
    expect(line).toBeDefined();
    if (line && line.kind === 'line') {
      expect(line.construction).toBe(true);
      const xs = [line.x1, line.x2];
      expect(Math.min(...xs)).toBeLessThanOrEqual(-5); // reaches past the left extent
      expect(Math.max(...xs)).toBeGreaterThanOrEqual(5); // and the right extent
      expect(line.y1).toBeCloseTo(0, 9);
      expect(line.y2).toBeCloseTo(0, 9);
    }
  });

  it('clamps a RAY to t≥0 (base toward the far box edge only)', () => {
    const r = toSketch(parseDxf(ents([
      '  0', 'CIRCLE', '  8', '0', ' 10', '0', ' 20', '0', ' 40', '5',
      '  0', 'RAY', '  8', '0', ' 10', '0', ' 20', '0', ' 11', '1', ' 21', '0',
    ].join('\n'))));
    const line = r.primitives.find((p) => p.kind === 'line');
    expect(line).toBeDefined();
    if (line && line.kind === 'line') {
      const xs = [line.x1, line.x2];
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1e-9); // never goes behind the base
      expect(Math.max(...xs)).toBeGreaterThanOrEqual(5);
    }
  });

  it('drops a zero-direction XLINE and tallies it', () => {
    const r = toSketch(parseDxf(ents([
      '  0', 'CIRCLE', '  8', '0', ' 10', '0', ' 20', '0', ' 40', '5',
      '  0', 'XLINE', '  8', '0', ' 10', '0', ' 20', '0', ' 11', '0', ' 21', '0',
    ].join('\n'))));
    expect(r.primitives.some((p) => p.kind === 'line')).toBe(false);
    expect(r.dropped.some((d) => d.kind === 'XLINE')).toBe(true);
  });

  it('emits a fixed-length fallback XLINE when there is no other geometry', () => {
    const r = toSketch(parseDxf(ents([
      '  0', 'XLINE', '  8', '0', ' 10', '0', ' 20', '0', ' 11', '1', ' 21', '0',
    ].join('\n'))));
    const lines = r.primitives.filter((p) => p.kind === 'line');
    expect(lines).toHaveLength(1);
    const l = lines[0]!;
    if (l.kind === 'line') {
      expect(l.construction).toBe(true);
      const len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
      expect(len).toBeCloseTo(100, 6);
    }
  });
});

describe('toSketch — HATCH polyline loop (Phase 4c)', () => {
  it('expands a HATCH polyline loop to closed construction segments (bulge → arc)', () => {
    const r = toSketch(parseDxf(ents([
      '  0', 'HATCH', '  8', '0',
      ' 91', '1', ' 92', '3', ' 72', '1', ' 73', '1', ' 93', '3',
      ' 10', '0', ' 20', '0', ' 42', '0',
      ' 10', '10', ' 20', '0', ' 42', '0.5',
      ' 10', '10', ' 20', '10', ' 42', '0',
      ' 97', '0',
    ].join('\n'))));
    // closed polyline with 3 vertices → 3 segments (last closes back to v0)
    expect(r.primitives).toHaveLength(3);
    expect(r.primitives.every((p) => p.construction === true)).toBe(true);
    const kinds = r.primitives.map((p) => p.kind).sort();
    expect(kinds).toEqual(['arc', 'line', 'line']);   // the bulge=0.5 segment becomes an arc
  });
});

describe('toSketch — HATCH ellipse + spline edges (Phase 4c)', () => {
  it('expands HATCH ellipse + spline edges to construction primitives', () => {
    const r = toSketch(parseDxf(ents([
      '  0', 'HATCH', '  8', '0',
      ' 91', '1', ' 92', '1', ' 93', '2',
      ' 72', '3', ' 10', '0', ' 20', '0', ' 11', '4', ' 21', '0', ' 40', '0.5',
      ' 50', '0', ' 51', '180', ' 73', '1',
      ' 72', '4', ' 94', '2', ' 73', '0', ' 74', '0', ' 95', '5', ' 96', '3',
      ' 40', '0', ' 40', '0', ' 40', '0.5', ' 40', '1', ' 40', '1',
      ' 10', '0', ' 20', '0', ' 10', '5', ' 20', '5', ' 10', '10', ' 20', '0',
      ' 97', '0',
    ].join('\n'))));
    expect(r.primitives).toHaveLength(2);
    expect(r.primitives.every((p) => p.construction === true)).toBe(true);
    const ell = r.primitives.find((p) => p.kind === 'ellipse')!;
    if (ell.kind === 'ellipse') {
      expect(ell.cx).toBeCloseTo(0, 9);
      expect(ell.cy).toBeCloseTo(0, 9);
      expect(ell.rx).toBeCloseTo(4, 9);              // major length 4, unit scale 1
      expect(ell.ry).toBeCloseTo(2, 9);              // ratio 0.5
      expect(ell.rotation).toBeCloseTo(0, 9);
      expect(ell.startAngle).toBeCloseTo(0, 9);
      expect(ell.endAngle).toBeCloseTo(Math.PI, 9);  // 180° → π
    }
    const sp = r.primitives.find((p) => p.kind === 'spline')!;
    if (sp.kind === 'spline') {
      expect(sp.degree).toBe(2);
      expect(sp.closed).toBe(false);
      expect(sp.controlPoints).toEqual([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }]);
    }
  });
});

describe('toSketch — HATCH edge loop (Phase 4c)', () => {
  it('expands a HATCH edge loop (line + arc) to construction primitives', () => {
    const r = toSketch(parseDxf(ents([
      '  0', 'HATCH', '  8', '0',
      ' 91', '1', ' 92', '1', ' 93', '2',
      ' 72', '1', ' 10', '0', ' 20', '0', ' 11', '10', ' 21', '0',
      ' 72', '2', ' 10', '10', ' 20', '0', ' 40', '5', ' 50', '0', ' 51', '90', ' 73', '1',
      ' 97', '0',
    ].join('\n'))));
    expect(r.primitives).toHaveLength(2);
    expect(r.primitives.every((p) => p.construction === true)).toBe(true);
    const line = r.primitives.find((p) => p.kind === 'line')!;
    if (line.kind === 'line') expect([line.x1, line.y1, line.x2, line.y2]).toEqual([0, 0, 10, 0]);
    const arc = r.primitives.find((p) => p.kind === 'arc')!;
    if (arc.kind === 'arc') {
      expect(arc.cx).toBeCloseTo(10, 9);
      expect(arc.cy).toBeCloseTo(0, 9);
      expect(arc.r).toBeCloseTo(5, 9);
      expect(arc.startAngle).toBeCloseTo(0, 9);
      expect(arc.endAngle).toBeCloseTo(Math.PI / 2, 9);
    }
  });
});

describe('toSketch — HATCH nested inside INSERT block (Phase 4c)', () => {
  it('expands a HATCH nested inside a block via INSERT', () => {
    const dxf = [
      '  0', 'SECTION', '  2', 'BLOCKS',
      '  0', 'BLOCK', '  2', 'HB', ' 10', '0', ' 20', '0',
      '  0', 'HATCH', '  8', '0',
      ' 91', '1', ' 92', '1', ' 93', '1',
      ' 72', '1', ' 10', '0', ' 20', '0', ' 11', '10', ' 21', '0',
      ' 97', '0',
      '  0', 'ENDBLK',
      '  0', 'ENDSEC',
      '  0', 'SECTION', '  2', 'ENTITIES',
      '  0', 'INSERT', '  2', 'HB', ' 10', '100', ' 20', '0',
      '  0', 'ENDSEC', '  0', 'EOF',
    ].join('\n');
    const r = toSketch(parseDxf(dxf));
    expect(r.primitives).toHaveLength(1);
    const p = r.primitives[0]!;
    expect(p.kind).toBe('line');
    expect(p.construction).toBe(true);
    // INSERT at (100,0) shifts the block-local line (0,0)→(10,0) to (100,0)→(110,0)
    if (p.kind === 'line') {
      expect(p.x1).toBeCloseTo(100, 9);
      expect(p.x2).toBeCloseTo(110, 9);
    }
  });
});

// ── Task 4: color/linetype style merge ──────────────────────────────────────

function dxfWithLayers(body: string[]): string {
  return ['0', 'SECTION', '2', 'TABLES',
    '0', 'TABLE', '2', 'LAYER',
    '0', 'LAYER', '2', 'walls', '62', '1', '6', 'CONTINUOUS', '70', '0',
    '0', 'LAYER', '2', 'hidden', '62', '5', '6', 'HIDDEN', '70', '0',
    '0', 'LAYER', '2', 'frozen', '62', '2', '6', 'CONTINUOUS', '70', '1',
    '0', 'ENDTAB', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES', ...body, '0', 'ENDSEC', '0', 'EOF'].join('\n');
}

describe('toSketch color/linetype', () => {
  it('attaches resolved color to a layer-coloured line', () => {
    const s = toSketch(parseDxf(dxfWithLayers(['0', 'LINE', '8', 'walls', '10', '0', '20', '0', '11', '10', '21', '0'])));
    const line = s.primitives.find((p) => p.kind === 'line')!;
    expect(line.color).toBe(0xff0000);
    expect(line.lineStyle).toBeUndefined();
  });

  it('attaches color + dashed lineStyle from a HIDDEN layer', () => {
    const s = toSketch(parseDxf(dxfWithLayers(['0', 'LINE', '8', 'hidden', '10', '0', '20', '0', '11', '10', '21', '0'])));
    const line = s.primitives.find((p) => p.kind === 'line')!;
    expect(line.color).toBe(0x0000ff);
    expect(line.lineStyle).toBe('dashed');
  });

  it('drops color/lineStyle on construction (frozen-layer) geometry', () => {
    const s = toSketch(parseDxf(dxfWithLayers(['0', 'LINE', '8', 'frozen', '10', '0', '20', '0', '11', '10', '21', '0'])));
    const line = s.primitives.find((p) => p.kind === 'line')!;
    expect(line.construction).toBe(true);
    expect(line.color).toBeUndefined();
    expect(line.lineStyle).toBeUndefined();
  });
});
