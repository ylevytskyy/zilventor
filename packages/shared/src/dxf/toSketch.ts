import type { ParsedDxf, DxfEntity, DxfLayer } from './types';
import type { SketchPrimitive, TextAnnotation } from '../types';

export type DxfDropped = { kind: string; count: number; reason: string };
export type ToSketchResult = { primitives: SketchPrimitive[]; annotations: TextAnnotation[]; dropped: DxfDropped[] };

/** Strip MTEXT inline formatting: \P→newline, \f.../\F... font, \A\C\c\H\W\Q\T\p control words, braces. */
export function stripMText(raw: string): string {
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

function formatMeasurement(v: number): string {
  // MVP formatting: 3-decimal, trailing zeros (and a bare trailing dot) trimmed.
  // No unit suffix and no dimstyle precision/tolerances (out of scope).
  return v.toFixed(3).replace(/\.?0+$/, '');
}

// MVP default text height (drawing units) for the no-block DIMENSION fallback; DIMENSION
// carries no reliable text-height group code (dimstyle is out of scope this slice).
const DIM_FALLBACK_TEXT_HEIGHT = 2.5;

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

/** Major-axis endpoint (OCS-mapped, relative to center) + ratio → sketch ellipse rx/ry/rotation.
 * Shared by the standalone ELLIPSE path and the HATCH ellipse-edge path. */
export function ellipseAxes(majX: number, majY: number, ratio: number, s: number): { rx: number; ry: number; rotation: number } {
  const rx = Math.hypot(majX, majY) * s;
  return { rx, ry: rx * ratio, rotation: Math.atan2(majY, majX) };
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
 * Apply an INSERT affine to a curve treated as a parametric ellipse and recover
 * the image ellipse's principal form via Rytz's construction.
 *
 * Source point at parameter s: P(s) = center + R(rotation)·(rx·cos s, ry·sin s).
 * The affine image of an ellipse is an ellipse; perpendicular source semi-axes map
 * to (generally non-perpendicular) conjugate semi-diameters u',v', from which Rytz
 * gives the principal semi-axes A ≥ B and major-axis angle φ.
 *
 * start/end are returned as PARAMETERS in the image's principal frame (matching the
 * `ellipse` primitive convention). For an isotropic image emitted as circle/arc, the
 * caller converts to a true angle by adding `rotation` (invariant under the arbitrary
 * φ Rytz returns for a circle).
 */
export function transformEllipse(
  m: Affine,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rotation: number,
  startParam?: number,
  endParam?: number,
): {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotation: number;
  startAngle?: number;
  endAngle?: number;
  isotropic: boolean;
} {
  // ── Degenerate INSERT guard (spec step 8) ───────────────────────────────────
  // If |det L| ≈ 0 the INSERT has collapsed the curve (e.g. xscale=0). Attempting
  // Rytz or mapParam on a zero-area image causes division by zero → NaN angles.
  // Fall back: map only the center via the affine, keep the original radii/rotation/
  // params as-is, and skip Rytz entirely. This is a pathological INSERT and the
  // resulting ellipse will be degenerate in the output, but we must not crash.
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) <= 1e-12) {
    const cx1d = m.a * cx + m.c * cy + m.e;
    const cy1d = m.b * cx + m.d * cy + m.f;
    const isotropicD = Math.abs(rx - ry) <= 1e-9 * (rx || 1);
    const outD: {
      cx: number; cy: number; rx: number; ry: number; rotation: number;
      startAngle?: number; endAngle?: number; isotropic: boolean;
    } = { cx: cx1d, cy: cy1d, rx, ry, rotation, isotropic: isotropicD };
    if (startParam !== undefined && endParam !== undefined) {
      outD.startAngle = startParam;
      outD.endAngle = endParam;
    }
    return outD;
  }
  // ────────────────────────────────────────────────────────────────────────────
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  // source semi-axis vectors  u = R(rot)·(rx,0),  v = R(rot)·(0,ry)
  const ux = rx * cosR;
  const uy = rx * sinR;
  const vx = -ry * sinR;
  const vy = ry * cosR;
  // linear part of the affine applied to u,v (translation dropped)
  const u1x = m.a * ux + m.c * uy;
  const u1y = m.b * ux + m.d * uy;
  const v1x = m.a * vx + m.c * vy;
  const v1y = m.b * vx + m.d * vy;
  // Rytz: principal axes from conjugate semi-diameters u1,v1
  const dotuv = u1x * v1x + u1y * v1y;
  const dotuu = u1x * u1x + u1y * u1y;
  const dotvv = v1x * v1x + v1y * v1y;
  const t = 0.5 * Math.atan2(2 * dotuv, dotuu - dotvv);
  const cosT = Math.cos(t);
  const sinT = Math.sin(t);
  const px = u1x * cosT + v1x * sinT;
  const py = u1y * cosT + v1y * sinT;
  const qx = -u1x * sinT + v1x * cosT;
  const qy = -u1y * sinT + v1y * cosT;
  const lenP = Math.hypot(px, py);
  const lenQ = Math.hypot(qx, qy);
  let A: number;
  let B: number;
  let majx: number;
  let majy: number;
  if (lenP >= lenQ) {
    A = lenP;
    B = lenQ;
    majx = px;
    majy = py;
  } else {
    A = lenQ;
    B = lenP;
    majx = qx;
    majy = qy;
  }
  const phi = Math.atan2(majy, majx);
  const cx1 = m.a * cx + m.c * cy + m.e;
  const cy1 = m.b * cx + m.d * cy + m.f;
  const isotropic = Math.abs(A - B) <= 1e-9 * (A || 1);
  const reflected = m.a * m.d - m.b * m.c < 0;

  const out: {
    cx: number; cy: number; rx: number; ry: number; rotation: number;
    startAngle?: number; endAngle?: number; isotropic: boolean;
  } = { cx: cx1, cy: cy1, rx: A, ry: B, rotation: phi, isotropic };

  if (startParam !== undefined && endParam !== undefined) {
    const cphi = Math.cos(phi);
    const sphi = Math.sin(phi);
    const mapParam = (s: number): number => {
      const lx = rx * Math.cos(s);
      const ly = ry * Math.sin(s);
      const wx = cx + cosR * lx - sinR * ly;
      const wy = cy + sinR * lx + cosR * ly;
      const tx = m.a * wx + m.c * wy + m.e;
      const ty = m.b * wx + m.d * wy + m.f;
      const dx = tx - cx1;
      const dy = ty - cy1;
      // R(-phi)·(dx,dy)
      const ex = cphi * dx + sphi * dy;
      const ey = -sphi * dx + cphi * dy;
      return Math.atan2(ey / B, ex / A);
    };
    let sa = mapParam(startParam);
    let ea = mapParam(endParam);
    if (reflected) {
      const tmp = sa;
      sa = ea;
      ea = tmp;
    }
    out.startAngle = sa;
    out.endAngle = ea;
  }
  return out;
}

// Build the right SketchPrimitive from a transformEllipse result, simplifying an
// isotropic image back to circle/arc. `hadAngles` is true for arc / elliptical-arc.
function buildCurveFromEllipse(
  e: ReturnType<typeof transformEllipse>,
  hadAngles: boolean,
  construction: boolean | undefined,
): SketchPrimitive {
  const cons = construction ? { construction: true } : {};
  if (e.isotropic) {
    if (hadAngles) {
      const sa = e.startAngle! + e.rotation;
      let ea = e.endAngle! + e.rotation;
      // atan2 in mapParam wraps to (-π,π]; restore CCW ordering so ea ≥ sa (mod 2π).
      while (ea < sa) ea += 2 * Math.PI;
      return {
        id: freshId(),
        kind: 'arc',
        cx: e.cx,
        cy: e.cy,
        r: e.rx,
        startAngle: sa,
        endAngle: ea,
        ...cons,
      };
    }
    return { id: freshId(), kind: 'circle', cx: e.cx, cy: e.cy, r: e.rx, ...cons };
  }
  const base = { id: freshId(), kind: 'ellipse' as const, cx: e.cx, cy: e.cy, rx: e.rx, ry: e.ry, rotation: e.rotation };
  if (hadAngles) {
    const sa = e.startAngle!;
    let ea = e.endAngle!;
    // atan2 in mapParam wraps to (-π,π]; restore CCW ordering so ea ≥ sa (mod 2π).
    // These are principal-frame params; rotation is applied separately by the consumer.
    while (ea < sa) ea += 2 * Math.PI;
    return { ...base, startAngle: sa, endAngle: ea, ...cons };
  }
  return { ...base, ...cons };
}

/**
 * Apply an affine transform to a SketchPrimitive, assigning a fresh id.
 *
 * 4b SIMPLIFYING ASSUMPTIONS (revisit in 4c):
 * - w/h of a rectangle are not scaled (same reasoning as before).
 * - Block-internal entities ignore their own OCS extrusion under an insert (rare, deferred).
 */
export function transformPrimitive(m: Affine, p: SketchPrimitive): SketchPrimitive {
  switch (p.kind) {
    case 'line': {
      const a = afApply(m, p.x1, p.y1), b = afApply(m, p.x2, p.y2);
      return { ...p, id: freshId(), x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }
    case 'circle': {
      const e = transformEllipse(m, p.cx, p.cy, p.r, p.r, 0);
      return buildCurveFromEllipse(e, false, p.construction);
    }
    case 'arc': {
      const e = transformEllipse(m, p.cx, p.cy, p.r, p.r, 0, p.startAngle, p.endAngle);
      return buildCurveFromEllipse(e, true, p.construction);
    }
    case 'ellipse': {
      const hadAngles = p.startAngle !== undefined && p.endAngle !== undefined;
      const e = transformEllipse(
        m, p.cx, p.cy, p.rx, p.ry, p.rotation,
        hadAngles ? p.startAngle : undefined,
        hadAngles ? p.endAngle : undefined,
      );
      return buildCurveFromEllipse(e, hadAngles, p.construction);
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
 * Array (COLUMNS×ROWS): each cell's local-frame offset (col*colSpacing, row*rowSpacing)
 * is rotated into WCS by the INSERT rotation angle θ before being added to ins.x/ins.y.
 * Per DXF spec, array spacing is defined in the block's local frame (not WCS), and is NOT
 * scaled by xscale/yscale.
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
    } else if (be.type === 'SOLID') {
      blockPrims.push(...expandSolid(be, 1));
    } else if (be.type === '3DFACE') {
      blockPrims.push(...expandFace(be, 1, drop));
    } else {
      const p = mapEntity(be, 1, drop, false);
      if (p) blockPrims.push(p);
    }
  }

  const out: SketchPrimitive[] = [];
  const cols = Math.max(1, ins.columns);
  const rows = Math.max(1, ins.rows);
  // Pre-compute rotation sin/cos for rotating the local-frame array offset into WCS.
  const θ = (ins.rotation * Math.PI) / 180;
  const cosθ = Math.cos(θ), sinθ = Math.sin(θ);
  // Scale matrix applied once to move from unit-block-WCS to document units.
  const scaleM: Affine = { a: s, b: 0, c: 0, d: s, e: 0, f: 0 };
  for (let cI = 0; cI < cols; cI++) {
    for (let rI = 0; rI < rows; rI++) {
      // Compute local-frame offset, then rotate into WCS before adding to insertion point.
      // Array spacing is in the INSERT's local frame (not WCS) and is NOT scaled by xscale/yscale.
      const dx = cI * ins.colSpacing, dy = rI * ins.rowSpacing;
      const offX = cosθ * dx - sinθ * dy;
      const offY = sinθ * dx + cosθ * dy;
      const placed = { ...ins, x: ins.x + offX, y: ins.y + offY };
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
  const pendingInfinite: Array<Extract<DxfEntity, { type: 'RAY' | 'XLINE' }>> = [];

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
    if (e.type === 'SOLID') {
      primitives.push(...expandSolid(e, s));
      continue;
    }
    if (e.type === 'HATCH') {
      primitives.push(...expandHatch(e, s, drop));
      continue;
    }
    if (e.type === '3DFACE') {
      primitives.push(...expandFace(e, s, drop));
      continue;
    }
    if (e.type === 'LEADER') {
      primitives.push(...expandLeader(e, s, drop));
      continue;
    }
    if (e.type === 'DIMENSION') {
      const body = e.block ? parsed.blocks[e.block] : undefined;
      if (e.block && body) {
        // Full fidelity: synthesize an identity INSERT and reuse expandInsert for the
        // drawn geometry (extension/dimension lines, arc dims, SOLID arrowheads).
        const synth: Extract<DxfEntity, { type: 'INSERT' }> = {
          type: 'INSERT', layer: e.layer, name: e.block,
          x: 0, y: 0, xscale: 1, yscale: 1, rotation: 0,
          columns: 1, rows: 1, colSpacing: 0, rowSpacing: 0,
        };
        primitives.push(...expandInsert(synth, parsed, s, 0, drop));
        // expandInsert is geometry-only and drops block text. Scan the block body for
        // TEXT/MTEXT and emit annotations under the same identity transform (subtract the
        // block base point, then apply the document unit scale).
        const base = parsed.blockBasePoints[e.block] ?? { x: 0, y: 0 };
        for (const be of body) {
          if (be.type === 'TEXT' || be.type === 'MTEXT') {
            const value = be.type === 'MTEXT' ? stripMText(be.value) : be.value;
            annotations.push({ id: freshId(), x: (be.x - base.x) * s, y: (be.y - base.y) * s,
              height: be.height * s, value, rotation: (be.rotation * Math.PI) / 180 });
          }
        }
      } else {
        // Fallback (block absent/unresolvable): one annotation at the text midpoint.
        const override = e.textOverride.trim();
        const value = override && override !== '<>' ? override : formatMeasurement(e.measurement);
        annotations.push({ id: freshId(), x: e.textMidX * s, y: e.textMidY * s,
          height: DIM_FALLBACK_TEXT_HEIGHT * s, value, rotation: 0 });
      }
      continue;
    }
    if (e.type === 'MLEADER') {
      if (e.leaderLines.length === 0 && !e.text) { drop('MLEADER', 'no usable leader lines or text'); continue; }
      for (const line of e.leaderLines) {
        for (let i = 0; i < line.length - 1; i++) {
          const a = line[i]!;
          const b = line[i + 1]!;
          primitives.push({ id: freshId(), kind: 'line', x1: a.x * s, y1: a.y * s, x2: b.x * s, y2: b.y * s, construction: true });
        }
      }
      if (e.text) {
        annotations.push({ id: freshId(), x: e.text.x * s, y: e.text.y * s,
          height: e.text.height * s, value: e.text.value, rotation: (e.text.rotation * Math.PI) / 180 });
      }
      continue;
    }
    if (e.type === 'RAY' || e.type === 'XLINE') { pendingInfinite.push(e); continue; }
    const construction = isConstructionLayer(parsed.layers, e.layer);
    if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
      primitives.push(...expandPolyline(e, s, construction));
      continue;
    }
    const prim = mapEntity(e, s, drop, construction);
    if (prim) primitives.push(prim);
  }
  if (pendingInfinite.length) {
    // Bounding box of all other emitted geometry, in scaled (mm) space.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of primitives) {
      const ext = primExtent(p);
      if (!ext) continue;
      minX = Math.min(minX, ext.minX); minY = Math.min(minY, ext.minY);
      maxX = Math.max(maxX, ext.maxX); maxY = Math.max(maxY, ext.maxY);
    }
    const hasBox = Number.isFinite(minX);
    // Margin so the clamped line clears the geometry; absolute floor handles a tiny/point box.
    const diag = hasBox ? Math.hypot(maxX - minX, maxY - minY) : 0;
    const margin = Math.max(diag * 0.1, 10);
    const box = { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };
    const FALLBACK_LEN = 100; // mm — reference line shown when there's nothing to clamp to
    for (const e of pendingInfinite) {
      const dlen = Math.hypot(e.dx, e.dy);
      if (dlen < 1e-12) { drop(e.type, 'zero direction'); continue; }
      const ux = e.dx / dlen, uy = e.dy / dlen;
      const bx = e.x * s, by = e.y * s; // base scales by s; direction is dimensionless
      let seg = hasBox ? clipToBox(bx, by, ux, uy, box, e.type === 'RAY') : null;
      if (!seg) {
        // Fixed-length fallback (NOT a drop): XLINE centered on base, RAY starting at base.
        seg = e.type === 'XLINE'
          ? { x1: bx - ux * FALLBACK_LEN / 2, y1: by - uy * FALLBACK_LEN / 2, x2: bx + ux * FALLBACK_LEN / 2, y2: by + uy * FALLBACK_LEN / 2 }
          : { x1: bx, y1: by, x2: bx + ux * FALLBACK_LEN, y2: by + uy * FALLBACK_LEN };
      }
      primitives.push({ id: freshId(), kind: 'line', x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2, construction: true });
    }
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

function expandLeader(
  e: Extract<DxfEntity, { type: 'LEADER' }>,
  s: number,
  drop: (k: string, r: string) => void,
): SketchPrimitive[] {
  if (e.vertices.length < 2) { drop('LEADER', 'fewer than 2 vertices'); return []; }
  const out: SketchPrimitive[] = [];
  for (let i = 0; i < e.vertices.length - 1; i++) {
    const a = e.vertices[i]!;
    const b = e.vertices[i + 1]!;
    out.push({ id: freshId(), kind: 'line', x1: a.x * s, y1: a.y * s, x2: b.x * s, y2: b.y * s, construction: true });
  }
  return out;
}

/** Emit a closed loop of construction lines from polygon corners (OCS→WCS, scaled by s). */
function closedLoop(corners: ReadonlyArray<{ x: number; y: number }>, extrusion: V3 | undefined, s: number): SketchPrimitive[] {
  const pts = corners.map((c) => ocsXY(extrusion, c.x, c.y));
  const out: SketchPrimitive[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    out.push({ id: freshId(), kind: 'line', x1: a.x * s, y1: a.y * s, x2: b.x * s, y2: b.y * s, construction: true });
  }
  return out;
}

/** Axis-aligned extent of a primitive in scaled (mm) space, or null if it has none. */
function primExtent(p: SketchPrimitive): { minX: number; minY: number; maxX: number; maxY: number } | null {
  switch (p.kind) {
    case 'line': return { minX: Math.min(p.x1, p.x2), minY: Math.min(p.y1, p.y2), maxX: Math.max(p.x1, p.x2), maxY: Math.max(p.y1, p.y2) };
    case 'rectangle': return { minX: p.x, minY: p.y, maxX: p.x + p.w, maxY: p.y + p.h };
    case 'circle':
    case 'arc': return { minX: p.cx - p.r, minY: p.cy - p.r, maxX: p.cx + p.r, maxY: p.cy + p.r };
    case 'ellipse': { const m = Math.max(p.rx, p.ry); return { minX: p.cx - m, minY: p.cy - m, maxX: p.cx + m, maxY: p.cy + m }; }
    case 'point': return { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
    case 'spline': {
      if (!p.controlPoints.length) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const c of p.controlPoints) { minX = Math.min(minX, c.x); minY = Math.min(minY, c.y); maxX = Math.max(maxX, c.x); maxY = Math.max(maxY, c.y); }
      return { minX, minY, maxX, maxY };
    }
    default: return null;
  }
}

/**
 * Slab-clip the parametric line P(t) = (bx,by) + t·(ux,uy) (unit dir) against an
 * axis-aligned box. Returns the clipped segment, or null when the line misses the box
 * (or, for a ray with t≥0, when the box is entirely behind the base).
 */
function clipToBox(
  bx: number, by: number, ux: number, uy: number,
  box: { minX: number; minY: number; maxX: number; maxY: number },
  ray: boolean,
): { x1: number; y1: number; x2: number; y2: number } | null {
  let t0 = -Infinity, t1 = Infinity;
  if (Math.abs(ux) < 1e-12) {
    if (bx < box.minX || bx > box.maxX) return null; // parallel to Y slab & outside
  } else {
    let ta = (box.minX - bx) / ux, tb = (box.maxX - bx) / ux;
    if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
  }
  if (Math.abs(uy) < 1e-12) {
    if (by < box.minY || by > box.maxY) return null; // parallel to X slab & outside
  } else {
    let ta = (box.minY - by) / uy, tb = (box.maxY - by) / uy;
    if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
  }
  if (t1 < t0) return null; // misses the box
  if (ray) { t0 = Math.max(t0, 0); if (t1 < t0) return null; } // box entirely behind base
  return { x1: bx + ux * t0, y1: by + uy * t0, x2: bx + ux * t1, y2: by + uy * t1 };
}

function expandHatch(e: Extract<DxfEntity, { type: 'HATCH' }>, s: number, drop: (k: string, r: string) => void): SketchPrimitive[] {
  const out: SketchPrimitive[] = [];
  const ext = e.extrusion;
  for (const loop of e.loops) {
    if (loop.kind === 'polyline') {
      out.push(...expandPolyline({ vertices: loop.vertices, closed: loop.closed, ...(ext ? { extrusion: ext } : {}) }, s, true));
    } else {
      // edges: Tasks 6/7
    }
  }
  return out;
}

function expandSolid(e: Extract<DxfEntity, { type: 'SOLID' }>, s: number): SketchPrimitive[] {
  // corners are already in winding order (0,1,3,2) from the parser. Emit a closed
  // construction loop. Fill is intentionally dropped (boundary only, consistent with HATCH).
  return closedLoop(e.corners, e.extrusion, s);
}

function expandFace(e: Extract<DxfEntity, { type: '3DFACE' }>, s: number, drop: (k: string, r: string) => void): SketchPrimitive[] {
  const eps = 1e-9;
  // Degenerate guard: fewer than 3 distinct corners → not a face.
  const distinct: Array<{ x: number; y: number; z: number }> = [];
  for (const p of e.corners) {
    if (!distinct.some((q) => Math.abs(q.x - p.x) < eps && Math.abs(q.y - p.y) < eps && Math.abs(q.z - p.z) < eps)) {
      distinct.push(p);
    }
  }
  if (distinct.length < 3) { drop('3DFACE', 'degenerate (fewer than 3 distinct corners)'); return []; }
  // Planar gate: every corner must share corner 0's z (else projecting onto XY distorts it).
  const z0 = e.corners[0]!.z;
  if (e.corners.some((p) => Math.abs(p.z - z0) > eps)) { drop('3DFACE', 'non-planar (corners not co-Z)'); return []; }
  // 3DFACE is WCS — no extrusion/OCS. Emit a closed construction loop (all edges; code 70
  // edge-visibility flags are ignored — documented limitation).
  return closedLoop(e.corners, undefined, s);
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
      const { rx, ry, rotation } = ellipseAxes(maj.x, maj.y, e.ratio, s);
      const full = isFullEllipse(e.startParam, e.endParam);
      // Known 4a limitation: trimmed ellipse under reflected OCS keeps raw start/end params.
      // Full ellipses (the common case) and all circles/arcs are correct. Revisited in 4c.
      // Branch-cut fix: restore CCW ordering so endParam ≥ startParam (mod 2π), matching the
      // arc producer convention. These are principal-frame params; rotation is applied separately.
      let endParam = e.endParam;
      while (endParam < e.startParam) endParam += 2 * Math.PI;
      return { id: freshId(), kind: 'ellipse', cx: c.x * s, cy: c.y * s, rx, ry, rotation,
        ...(full ? {} : { startAngle: e.startParam, endAngle: endParam }), ...cons };
    }
    case 'SPLINE': {
      const poles = e.controlPoints.length ? e.controlPoints : e.fitPoints;
      if (poles.length < 2) { drop('SPLINE', 'fewer than 2 defining points'); return null; }
      const degree = Math.min(e.degree, poles.length - 1);
      return { id: freshId(), kind: 'spline',
        controlPoints: poles.map((p) => ({ x: p.x * s, y: p.y * s })), degree, closed: e.closed, ...cons };
    }
    case 'POINT': {
      const wp = ocsXY(e.extrusion, e.x, e.y);
      return { id: freshId(), kind: 'point', x: wp.x * s, y: wp.y * s, ...cons };
    }
    case 'TEXT': return null; // handled before mapEntity in toSketch loop
    case 'MTEXT': return null; // handled before mapEntity in toSketch loop
    case 'INSERT': drop('INSERT', 'INSERT reached mapEntity — should be handled by expandInsert'); return null;
    default: drop((e as { type: string }).type, 'unsupported in Phase 4a'); return null;
  }
}
