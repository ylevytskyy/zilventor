import type { ParsedDxf, DxfEntity } from './types';
import type { SketchPrimitive } from '../types';

export type DxfDropped = { kind: string; count: number; reason: string };
export type ToSketchResult = { primitives: SketchPrimitive[]; annotations: never[]; dropped: DxfDropped[] };

function freshId(): string { return `dxf-${crypto.randomUUID().slice(0, 8)}`; }

const INSUNITS_FACTOR: Record<string, number> = { '1': 25.4, '2': 304.8, '4': 1, '5': 10, '6': 1000 };
function unitFactor(header: Record<string, string>): number {
  return INSUNITS_FACTOR[header['$INSUNITS'] ?? ''] ?? 1;
}

const TAU = 2 * Math.PI;
function isFullEllipse(start: number, end: number): boolean {
  return Math.abs(start) < 1e-9 && Math.abs(end - TAU) < 1e-9;
}

export function toSketch(parsed: ParsedDxf): ToSketchResult {
  const s = unitFactor(parsed.header);
  const primitives: SketchPrimitive[] = [];
  const droppedMap = new Map<string, DxfDropped>();
  const drop = (kind: string, reason: string): void => {
    const cur = droppedMap.get(kind);
    if (cur) cur.count += 1;
    else droppedMap.set(kind, { kind, count: 1, reason });
  };

  for (const e of parsed.entities) {
    const prim = mapEntity(e, s, drop);
    if (prim) primitives.push(prim);
  }
  return { primitives, annotations: [], dropped: [...droppedMap.values()] };
}

function mapEntity(e: DxfEntity, s: number, drop: (k: string, r: string) => void): SketchPrimitive | null {
  switch (e.type) {
    case 'LINE':
      return { id: freshId(), kind: 'line', x1: e.x1 * s, y1: e.y1 * s, x2: e.x2 * s, y2: e.y2 * s };
    case 'CIRCLE':
      return { id: freshId(), kind: 'circle', cx: e.cx * s, cy: e.cy * s, r: e.r * s };
    case 'ARC':
      return { id: freshId(), kind: 'arc', cx: e.cx * s, cy: e.cy * s, r: e.r * s,
        startAngle: (e.startAngle * Math.PI) / 180, endAngle: (e.endAngle * Math.PI) / 180 };
    case 'ELLIPSE': {
      const rx = Math.hypot(e.majorX, e.majorY) * s;
      const ry = rx * e.ratio;
      const rotation = Math.atan2(e.majorY, e.majorX);
      const full = isFullEllipse(e.startParam, e.endParam);
      return { id: freshId(), kind: 'ellipse', cx: e.cx * s, cy: e.cy * s, rx, ry, rotation,
        ...(full ? {} : { startAngle: e.startParam, endAngle: e.endParam }) };
    }
    case 'SPLINE': {
      const poles = e.controlPoints.length ? e.controlPoints : e.fitPoints;
      if (poles.length < 2) { drop('SPLINE', 'fewer than 2 defining points'); return null; }
      const degree = Math.min(e.degree, poles.length - 1);
      return { id: freshId(), kind: 'spline',
        controlPoints: poles.map((p) => ({ x: p.x * s, y: p.y * s })), degree, closed: e.closed };
    }
    case 'LWPOLYLINE': drop('LWPOLYLINE', 'polyline mapping lands in task 6'); return null;
    case 'POLYLINE': drop('POLYLINE', 'polyline mapping lands in task 6'); return null;
    case 'TEXT': drop('TEXT', 'text annotation model is Phase 4b'); return null;
    case 'MTEXT': drop('MTEXT', 'text annotation model is Phase 4b'); return null;
    case 'INSERT': drop('INSERT', 'block flatten is Phase 4b'); return null;
    default: drop((e as { type: string }).type, 'unsupported in Phase 4a'); return null;
  }
}
