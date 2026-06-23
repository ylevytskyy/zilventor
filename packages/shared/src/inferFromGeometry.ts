import type { SketchPrimitive } from './types';
import type { SketchConstraint, PointRef } from './constraints';

const EPS = 1e-3;

function endpointsOf(p: SketchPrimitive): Array<{ anchor: PointRef['anchor']; x: number; y: number }> {
  switch (p.kind) {
    case 'line':      return [{ anchor: 'start', x: p.x1, y: p.y1 }, { anchor: 'end', x: p.x2, y: p.y2 }];
    case 'arc': {
      const sx = p.cx + p.r * Math.cos(p.startAngle);
      const sy = p.cy + p.r * Math.sin(p.startAngle);
      const ex = p.cx + p.r * Math.cos(p.endAngle);
      const ey = p.cy + p.r * Math.sin(p.endAngle);
      return [
        { anchor: 'center', x: p.cx, y: p.cy },
        { anchor: 'start',  x: sx,   y: sy },
        { anchor: 'end',    x: ex,   y: ey },
      ];
    }
    case 'circle':    return [{ anchor: 'center', x: p.cx, y: p.cy }];
    case 'rectangle': return [];
    case 'spline':    return p.controlPoints.map((cp, i) => ({ anchor: `cp${i}` as const, x: cp.x, y: cp.y }));
    case 'point':   return [{ anchor: 'center', x: p.x, y: p.y }];
    case 'ellipse': {
      const out: Array<{ anchor: PointRef['anchor']; x: number; y: number }> = [
        { anchor: 'center', x: p.cx, y: p.cy },
      ];
      if (p.startAngle !== undefined && p.endAngle !== undefined) {
        const cr = Math.cos(p.rotation), sr = Math.sin(p.rotation);
        const pt = (t: number) => {
          const lx = p.rx * Math.cos(t), ly = p.ry * Math.sin(t);
          return { x: p.cx + lx * cr - ly * sr, y: p.cy + lx * sr + ly * cr };
        };
        const s = pt(p.startAngle), e = pt(p.endAngle);
        out.push({ anchor: 'start', x: s.x, y: s.y }, { anchor: 'end', x: e.x, y: e.y });
      }
      return out;
    }
  }
}

export function inferFromGeometry(primitives: SketchPrimitive[]): SketchConstraint[] {
  const out: SketchConstraint[] = [];

  // Per-line horizontal / vertical (mutually exclusive via else-if)
  for (const p of primitives) {
    if (p.kind !== 'line') continue;
    if (Math.abs(p.y2 - p.y1) < EPS) {
      out.push({ id: `c-inf-h-${p.id}`, kind: 'horizontal', line: p.id, source: 'inferred-migration' });
    } else if (Math.abs(p.x2 - p.x1) < EPS) {
      out.push({ id: `c-inf-v-${p.id}`, kind: 'vertical', line: p.id, source: 'inferred-migration' });
    }
  }

  // Pairwise endpoint coincidence (squared-distance, no sqrt)
  const collected: Array<{ primitiveId: string; anchor: PointRef['anchor']; x: number; y: number }> = [];
  for (const p of primitives) {
    for (const e of endpointsOf(p)) collected.push({ primitiveId: p.id, ...e });
  }
  for (let i = 0; i < collected.length; i++) {
    for (let j = i + 1; j < collected.length; j++) {
      const a = collected[i]!, b = collected[j]!;
      if (a.primitiveId === b.primitiveId) continue;
      const dx = a.x - b.x, dy = a.y - b.y;
      if (dx * dx + dy * dy < EPS * EPS) {
        // Sort sides lexicographically so ID is stable regardless of iteration order
        const keyA = `${a.primitiveId}-${a.anchor}`;
        const keyB = `${b.primitiveId}-${b.anchor}`;
        const [sideL, sideR] = keyA <= keyB ? [a, b] : [b, a];
        out.push({
          id: `c-inf-coi-${sideL.primitiveId}-${sideL.anchor}-${sideR.primitiveId}-${sideR.anchor}`,
          kind: 'coincident',
          a: { primitiveId: sideL.primitiveId, anchor: sideL.anchor },
          b: { primitiveId: sideR.primitiveId, anchor: sideR.anchor },
          source: 'inferred-migration',
        });
      }
    }
  }
  return out;
}
