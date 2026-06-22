import type { ParsedDxf, DxfEntity } from './types';
import type { SketchPrimitive } from '../types';

export type DxfDropped = { kind: string; count: number; reason: string };
export type ToSketchResult = { primitives: SketchPrimitive[]; annotations: never[]; dropped: DxfDropped[] };

function freshId(): string { return `dxf-${crypto.randomUUID().slice(0, 8)}`; }

// ── OCS→WCS helpers (DXF Arbitrary Axis Algorithm) ──────────────────────────
type V3 = { x: number; y: number; z: number };
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (v: V3): V3 => { const m = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / m, y: v.y / m, z: v.z / m }; };

/** Arbitrary Axis Algorithm: OCS basis vectors for extrusion n. */
function ocsBasis(n: V3): { ax: V3; ay: V3 } {
  const wy: V3 = { x: 0, y: 1, z: 0 };
  const wz: V3 = { x: 0, y: 0, z: 1 };
  const ax = norm((Math.abs(n.x) < 1 / 64 && Math.abs(n.y) < 1 / 64) ? cross(wy, n) : cross(wz, n));
  const ay = norm(cross(n, ax));
  return { ax, ay };
}

/** Map an OCS (px,py) point to WCS XY, dropping z (2D import). */
function ocsXY(ext: V3 | undefined, px: number, py: number): { x: number; y: number } {
  if (!ext || (ext.x === 0 && ext.y === 0 && ext.z === 1)) return { x: px, y: py };
  const { ax, ay } = ocsBasis(ext);
  return { x: px * ax.x + py * ay.x, y: px * ax.y + py * ay.y };
}

/** True when the OCS→XY projection reverses orientation (e.g. extrusion (0,0,-1)). */
function ocsReflected(ext: V3 | undefined): boolean {
  if (!ext || (ext.x === 0 && ext.y === 0 && ext.z === 1)) return false;
  const { ax, ay } = ocsBasis(ext);
  return ax.x * ay.y - ax.y * ay.x < 0;
}
// ────────────────────────────────────────────────────────────────────────────

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
    case 'CIRCLE': {
      const c = ocsXY(e.extrusion, e.cx, e.cy);
      return { id: freshId(), kind: 'circle', cx: c.x * s, cy: c.y * s, r: e.r * s };
    }
    case 'ARC': {
      const a0 = (e.startAngle * Math.PI) / 180, a1 = (e.endAngle * Math.PI) / 180;
      const c = ocsXY(e.extrusion, e.cx, e.cy);
      // Transform the two arc endpoints to WCS, recompute angles from WCS center, swap if reflected.
      const sp = ocsXY(e.extrusion, e.cx + e.r * Math.cos(a0), e.cy + e.r * Math.sin(a0));
      const ep = ocsXY(e.extrusion, e.cx + e.r * Math.cos(a1), e.cy + e.r * Math.sin(a1));
      const sa = Math.atan2(sp.y - c.y, sp.x - c.x);
      const ea = Math.atan2(ep.y - c.y, ep.x - c.x);
      const [startAngle, endAngle] = ocsReflected(e.extrusion) ? [ea, sa] : [sa, ea];
      return { id: freshId(), kind: 'arc', cx: c.x * s, cy: c.y * s, r: e.r * s, startAngle, endAngle };
    }
    case 'ELLIPSE': {
      const c = ocsXY(e.extrusion, e.cx, e.cy);
      // Transform major-axis direction vector (linear part only; center maps separately).
      const maj = ocsXY(e.extrusion, e.majorX, e.majorY);
      const rx = Math.hypot(maj.x, maj.y) * s;
      const ry = rx * e.ratio;
      const rotation = Math.atan2(maj.y, maj.x);
      const full = isFullEllipse(e.startParam, e.endParam);
      // Known 4a limitation: trimmed ellipse under reflected OCS keeps raw start/end params.
      // Full ellipses (the common case) and all circles/arcs are correct. Revisited in 4c.
      return { id: freshId(), kind: 'ellipse', cx: c.x * s, cy: c.y * s, rx, ry, rotation,
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
