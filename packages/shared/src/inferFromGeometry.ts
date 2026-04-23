import type { SketchPrimitive } from './types';
import type { SketchConstraint, PointRef } from './constraints';

const EPS = 1e-3;

function endpointsOf(p: SketchPrimitive): Array<{ anchor: PointRef['anchor']; x: number; y: number }> {
  switch (p.kind) {
    case 'line':      return [{ anchor: 'start', x: p.x1, y: p.y1 }, { anchor: 'end', x: p.x2, y: p.y2 }];
    case 'arc':       return [{ anchor: 'center', x: p.cx, y: p.cy }];
    case 'circle':    return [{ anchor: 'center', x: p.cx, y: p.cy }];
    case 'rectangle': return [];
    case 'spline':    return p.controlPoints.map((cp, i) => ({ anchor: `cp${i}` as const, x: cp.x, y: cp.y }));
  }
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `c-inf-${Date.now().toString(36)}-${seq.toString(36)}`;
}

export function inferFromGeometry(primitives: SketchPrimitive[]): SketchConstraint[] {
  const out: SketchConstraint[] = [];

  // Per-line horizontal / vertical (mutually exclusive via else-if)
  for (const p of primitives) {
    if (p.kind !== 'line') continue;
    if (Math.abs(p.y2 - p.y1) < EPS) {
      out.push({ id: nextId(), kind: 'horizontal', line: p.id, source: 'inferred-migration' });
    } else if (Math.abs(p.x2 - p.x1) < EPS) {
      out.push({ id: nextId(), kind: 'vertical', line: p.id, source: 'inferred-migration' });
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
        out.push({
          id: nextId(),
          kind: 'coincident',
          a: { primitiveId: a.primitiveId, anchor: a.anchor },
          b: { primitiveId: b.primitiveId, anchor: b.anchor },
          source: 'inferred-migration',
        });
      }
    }
  }
  return out;
}
