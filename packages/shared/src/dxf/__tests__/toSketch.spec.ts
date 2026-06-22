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

  it('tallies unsupported entities into dropped (LWPOLYLINE handled in task 6)', () => {
    const r = toSketch(parseDxf(ents(['  0','LWPOLYLINE','  8','0',' 90','2',' 10','0',' 20','0',' 10','5',' 20','5'].join('\n'))));
    expect(r.primitives).toHaveLength(0);
    expect(r.dropped.find((d) => d.kind === 'LWPOLYLINE')?.count).toBe(1);
  });
});
