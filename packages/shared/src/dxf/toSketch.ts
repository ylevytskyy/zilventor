import type { ParsedDxf, DxfEntity, DxfLayer } from './types';
import type { SketchPrimitive, TextAnnotation } from '../types';

export type DxfDropped = { kind: string; count: number; reason: string };
export type ToSketchResult = { primitives: SketchPrimitive[]; annotations: TextAnnotation[]; dropped: DxfDropped[] };

/** Strip MTEXT inline formatting: \P→newline, \f.../\F... font, \A\C\c\H\W\Q\T\p control words, braces. */
function stripMText(raw: string): string {
  return raw
    .replace(/\\P/g, '\n')
    .replace(/\\[fF][^;]*;/g, '')
    .replace(/\\[ACcHWQTp][^;\\{}]*;?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\\(.)/g, '$1');
}

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

/** Entities on DEFPOINTS (case-insensitive) or a frozen layer (flags bit 0 set) are construction geometry. */
function isConstructionLayer(layers: Record<string, DxfLayer>, layer: string): boolean {
  if (layer.toUpperCase() === 'DEFPOINTS') return true;
  const l = layers[layer];
  return !!l && (l.flags & 1) === 1;
}

const TAU = 2 * Math.PI;
function isFullEllipse(start: number, end: number): boolean {
  return Math.abs(start) < 1e-9 && Math.abs(end - TAU) < 1e-9;
}

// ── Affine-transform helpers for INSERT flattening ──────────────────────────
// Column-major 2D affine matrix: [[a c e],[b d f]]
type Affine = { a: number; b: number; c: number; d: number; e: number; f: number };
const afApply = (m: Affine, x: number, y: number): { x: number; y: number } =>
  ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
const afMul = (m: Affine, n: Affine): Affine => ({
  a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b,
  c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d,
  e: m.a * n.e + m.c * n.f + m.e, f: m.b * n.e + m.d * n.f + m.f,
});

/**
 * Build the composite affine for one INSERT cell:
 *   T(ins) ∘ R(rotation) ∘ S(xscale,yscale) ∘ T(-base)
 * Applied in order: subtract base, scale, rotate, translate to insertion point.
 */
function insertMatrix(ins: { x: number; y: number; xscale: number; yscale: number; rotation: number }, base: { x: number; y: number }): Affine {
  const r = (ins.rotation * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  // S ∘ T(-base): scale while shifting origin to base point
  const scaleBase: Affine = { a: ins.xscale, b: 0, c: 0, d: ins.yscale, e: -base.x * ins.xscale, f: -base.y * ins.yscale };
  const rot: Affine = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
  const trans: Affine = { a: 1, b: 0, c: 0, d: 1, e: ins.x, f: ins.y };
  return afMul(trans, afMul(rot, scaleBase));
}

/**
 * Apply an affine transform to a SketchPrimitive, assigning a fresh id.
 *
 * 4b SIMPLIFYING ASSUMPTIONS (revisit in 4c):
 * - circle/arc/ellipse RADII are NOT scaled by xscale/yscale (only centers move).
 *   This is correct for the dominant unit-scale (1,1) inserts; non-uniform curved
 *   geometry scaling is deferred to 4c.
 * - w/h of a rectangle are also not scaled (same reasoning).
 * - Block-internal entities ignore their own OCS extrusion under an insert (rare, deferred).
 */
function transformPrimitive(m: Affine, p: SketchPrimitive): SketchPrimitive {
  switch (p.kind) {
    case 'line': {
      const a = afApply(m, p.x1, p.y1), b = afApply(m, p.x2, p.y2);
      return { ...p, id: freshId(), x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }
    case 'circle': {
      const c = afApply(m, p.cx, p.cy);
      return { ...p, id: freshId(), cx: c.x, cy: c.y }; // radius unchanged (4b)
    }
    case 'arc': {
      const c = afApply(m, p.cx, p.cy);
      return { ...p, id: freshId(), cx: c.x, cy: c.y }; // radius/angles unchanged (4b)
    }
    case 'ellipse': {
      const c = afApply(m, p.cx, p.cy);
      return { ...p, id: freshId(), cx: c.x, cy: c.y }; // rx/ry/rotation unchanged (4b)
    }
    case 'spline': {
      return { ...p, id: freshId(), controlPoints: p.controlPoints.map((cp) => afApply(m, cp.x, cp.y)) };
    }
    case 'point': {
      const c = afApply(m, p.x, p.y);
      return { ...p, id: freshId(), x: c.x, y: c.y };
    }
    case 'rectangle': {
      const c = afApply(m, p.x, p.y);
      return { ...p, id: freshId(), x: c.x, y: c.y }; // w/h unchanged (4b)
    }
  }
}

/**
 * Recursively expand one INSERT entity into a flat list of SketchPrimitives.
 * Depth guard: max 16 levels to prevent infinite recursion on cyclic block references.
 * Array (COLUMNS×ROWS): each cell's origin is offset by (col*colSpacing, row*rowSpacing)
 * added to the INSERT insertion point before building the matrix (i.e., in WCS for rotation=0,
 * matches DXF rectangular-pattern behaviour for the dominant axis-aligned case).
 */
function expandInsert(
  ins: Extract<DxfEntity, { type: 'INSERT' }>,
  parsed: ParsedDxf,
  s: number,
  depth: number,
  drop: (k: string, r: string) => void,
): SketchPrimitive[] {
  if (depth > 16) { drop('INSERT', 'block nesting deeper than 16 levels'); return []; }
  const body = parsed.blocks[ins.name];
  if (!body) { drop('INSERT', `unknown block ${ins.name}`); return []; }
  const base = parsed.blockBasePoints[ins.name] ?? { x: 0, y: 0 };

  // Map the block body once at unit scale (the document scale s is applied
  // to the final WCS coordinates below, not inside the block frame).
  const blockPrims: SketchPrimitive[] = [];
  for (const be of body) {
    if (be.type === 'INSERT') {
      // Nested INSERT: recurse; the outer matrix handles the final scale.
      blockPrims.push(...expandInsert(be, parsed, 1, depth + 1, drop));
    } else if (be.type === 'LWPOLYLINE' || be.type === 'POLYLINE') {
      blockPrims.push(...expandPolyline(be, 1, false));
    } else {
      const p = mapEntity(be, 1, drop, false);
      if (p) blockPrims.push(p);
    }
  }

  const out: SketchPrimitive[] = [];
  const cols = Math.max(1, ins.columns);
  const rows = Math.max(1, ins.rows);
  // Scale matrix applied once to move from unit-block-WCS to document units.
  const scaleM: Affine = { a: s, b: 0, c: 0, d: s, e: 0, f: 0 };
  for (let cI = 0; cI < cols; cI++) {
    for (let rI = 0; rI < rows; rI++) {
      // Offset the insertion point for each array cell, then build the insert matrix.
      const placed = { ...ins, x: ins.x + cI * ins.colSpacing, y: ins.y + rI * ins.rowSpacing };
      const m = insertMatrix(placed, base);
      for (const bp of blockPrims) {
        // Apply insert transform, then document unit scale.
        out.push(transformPrimitive(scaleM, transformPrimitive(m, bp)));
      }
    }
  }
  return out;
}
// ────────────────────────────────────────────────────────────────────────────

export function toSketch(parsed: ParsedDxf): ToSketchResult {
  const s = unitFactor(parsed.header);
  const primitives: SketchPrimitive[] = [];
  const annotations: TextAnnotation[] = [];
  const droppedMap = new Map<string, DxfDropped>();
  const drop = (kind: string, reason: string): void => {
    const cur = droppedMap.get(kind);
    if (cur) cur.count += 1;
    else droppedMap.set(kind, { kind, count: 1, reason });
  };

  for (const e of parsed.entities) {
    if (e.type === 'INSERT') {
      primitives.push(...expandInsert(e, parsed, s, 0, drop));
      continue;
    }
    if (e.type === 'TEXT' || e.type === 'MTEXT') {
      const value = e.type === 'MTEXT' ? stripMText(e.value) : e.value;
      annotations.push({ id: freshId(), x: e.x * s, y: e.y * s, height: e.height * s, value, rotation: (e.rotation * Math.PI) / 180 });
      continue;
    }
    const construction = isConstructionLayer(parsed.layers, e.layer);
    if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
      primitives.push(...expandPolyline(e, s, construction));
      continue;
    }
    const prim = mapEntity(e, s, drop, construction);
    if (prim) primitives.push(prim);
  }
  return { primitives, annotations, dropped: [...droppedMap.values()] };
}

function expandPolyline(
  e: { vertices: Array<{ x: number; y: number; bulge: number }>; closed: boolean; extrusion?: V3 },
  s: number,
  construction: boolean,
): SketchPrimitive[] {
  const out: SketchPrimitive[] = [];
  const v = e.vertices;
  const n = v.length;
  if (n < 2) return out;
  const last = e.closed ? n : n - 1;
  const refl = ocsReflected(e.extrusion);
  for (let i = 0; i < last; i++) {
    const a = v[i]!;
    const b = v[(i + 1) % n]!;
    const pa = ocsXY(e.extrusion, a.x, a.y);
    const pb = ocsXY(e.extrusion, b.x, b.y);
    out.push(segment(pa.x * s, pa.y * s, pb.x * s, pb.y * s, refl ? -a.bulge : a.bulge, construction));
  }
  return out;
}

function segment(x1: number, y1: number, x2: number, y2: number, bulge: number, construction: boolean): SketchPrimitive {
  const cons = construction ? { construction: true as const } : {};
  if (bulge === 0) return { id: freshId(), kind: 'line', x1, y1, x2, y2, ...cons };
  const theta = 4 * Math.atan(bulge);                  // signed included angle
  const dx = x2 - x1, dy = y2 - y1;
  const c = Math.hypot(dx, dy);
  const r = Math.abs(c / (2 * Math.sin(theta / 2)));   // radius
  const ux = dx / c, uy = dy / c;                      // chord unit vector
  const nx = -uy, ny = ux;                             // left normal (+90°)
  const apothem = Math.cos(theta / 2) * r;             // midpoint→center distance (magnitude)
  const sign = bulge >= 0 ? -1 : 1;                    // center on side opposite the bulge
  const cx = (x1 + x2) / 2 + sign * apothem * nx;
  const cy = (y1 + y2) / 2 + sign * apothem * ny;
  const a1 = Math.atan2(y1 - cy, x1 - cx);
  const a2 = Math.atan2(y2 - cy, x2 - cx);
  // sketch arc is CCW start→end; for bulge>0 the swept span is a2→a1 (swap), else a1→a2
  const [startAngle, endAngle] = bulge > 0 ? [a2, a1] : [a1, a2];
  return { id: freshId(), kind: 'arc', cx, cy, r, startAngle, endAngle, ...cons };
}

function mapEntity(e: DxfEntity, s: number, drop: (k: string, r: string) => void, construction: boolean): SketchPrimitive | null {
  const cons = construction ? { construction: true as const } : {};
  switch (e.type) {
    case 'LINE':
      return { id: freshId(), kind: 'line', x1: e.x1 * s, y1: e.y1 * s, x2: e.x2 * s, y2: e.y2 * s, ...cons };
    case 'CIRCLE': {
      const c = ocsXY(e.extrusion, e.cx, e.cy);
      return { id: freshId(), kind: 'circle', cx: c.x * s, cy: c.y * s, r: e.r * s, ...cons };
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
      return { id: freshId(), kind: 'arc', cx: c.x * s, cy: c.y * s, r: e.r * s, startAngle, endAngle, ...cons };
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
        ...(full ? {} : { startAngle: e.startParam, endAngle: e.endParam }), ...cons };
    }
    case 'SPLINE': {
      const poles = e.controlPoints.length ? e.controlPoints : e.fitPoints;
      if (poles.length < 2) { drop('SPLINE', 'fewer than 2 defining points'); return null; }
      const degree = Math.min(e.degree, poles.length - 1);
      return { id: freshId(), kind: 'spline',
        controlPoints: poles.map((p) => ({ x: p.x * s, y: p.y * s })), degree, closed: e.closed, ...cons };
    }
    case 'POINT':
      return { id: freshId(), kind: 'point', x: e.x * s, y: e.y * s, ...cons };
    case 'TEXT': return null; // handled before mapEntity in toSketch loop
    case 'MTEXT': return null; // handled before mapEntity in toSketch loop
    case 'INSERT': drop('INSERT', 'INSERT reached mapEntity — should be handled by expandInsert'); return null;
    default: drop((e as { type: string }).type, 'unsupported in Phase 4a'); return null;
  }
}
