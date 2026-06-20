// packages/app/src/drawing/parseDxfUnderlay.ts
// F1 (DXF underlay parser) — pure function; no side effects.
// Now backed by the dependency-free shared DXF codec (@zilventor/shared) instead of dxf-parser.
//
// NOTE on bulge/arc segments in LWPOLYLINE/POLYLINE:
//   Non-zero bulge values describe arc segments. For the backdrop use-case these are
//   approximated as straight chord segments (vertex-to-vertex). Intentional MVP limitation.

import { parseDxf } from '@zilventor/shared';
import type { DxfEntity, UnderlayEntity, DxfUnderlay } from '@zilventor/shared';

function mapEntity(e: DxfEntity, dx: number, dy: number): UnderlayEntity | null {
  switch (e.type) {
    case 'LINE':
      return { kind: 'line', x1: e.x1 + dx, y1: e.y1 + dy, x2: e.x2 + dx, y2: e.y2 + dy };
    case 'LWPOLYLINE':
    case 'POLYLINE':
      if (e.vertices.length === 0) return null;
      return { kind: 'polyline', points: e.vertices.map((v) => [v.x + dx, v.y + dy] as const), closed: e.closed };
    case 'CIRCLE':
      return { kind: 'circle', cx: e.cx + dx, cy: e.cy + dy, r: e.r };
    case 'ARC':
      // Shared parser already returns degrees — no radian conversion.
      return { kind: 'arc', cx: e.cx + dx, cy: e.cy + dy, r: e.r, startAngle: e.startAngle, endAngle: e.endAngle };
    case 'TEXT':
    case 'MTEXT':
      return { kind: 'text', x: e.x + dx, y: e.y + dy, height: e.height, value: e.value, rotation: e.rotation };
    // SPLINE, ELLIPSE, INSERT handled elsewhere / skipped.
    default:
      return null;
  }
}

function flattenInsert(
  name: string, dx: number, dy: number,
  blocks: Record<string, DxfEntity[]>, depth: number, out: UnderlayEntity[],
): void {
  if (depth > 4) return;
  const block = blocks[name];
  if (!block) return;
  for (const child of block) {
    if (child.type === 'INSERT') {
      flattenInsert(child.name, dx + child.x, dy + child.y, blocks, depth + 1, out);
    } else {
      const mapped = mapEntity(child, dx, dy);
      if (mapped) out.push(mapped);
    }
  }
}

type BBox = { minX: number; minY: number; maxX: number; maxY: number };

function expand(bb: BBox, x: number, y: number): void {
  if (x < bb.minX) bb.minX = x;
  if (x > bb.maxX) bb.maxX = x;
  if (y < bb.minY) bb.minY = y;
  if (y > bb.maxY) bb.maxY = y;
}

function computeBBox(entities: ReadonlyArray<UnderlayEntity>): BBox | undefined {
  if (entities.length === 0) return undefined;
  const bb: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const e of entities) {
    switch (e.kind) {
      case 'line': expand(bb, e.x1, e.y1); expand(bb, e.x2, e.y2); break;
      case 'polyline': for (const [px, py] of e.points) expand(bb, px, py); break;
      case 'circle': expand(bb, e.cx - e.r, e.cy - e.r); expand(bb, e.cx + e.r, e.cy + e.r); break;
      case 'arc': expand(bb, e.cx - e.r, e.cy - e.r); expand(bb, e.cx + e.r, e.cy + e.r); break;
      case 'text': expand(bb, e.x, e.y); break;
    }
  }
  if (!isFinite(bb.minX)) return undefined;
  return bb;
}

export function parseDxfUnderlay(dxfText: string, fileName: string): DxfUnderlay {
  const lastDot = fileName.lastIndexOf('.');
  const name = lastDot > 0 ? fileName.slice(0, lastDot) : fileName;

  const parsed = parseDxf(dxfText); // never throws
  const out: UnderlayEntity[] = [];
  for (const e of parsed.entities) {
    if (e.type === 'INSERT') {
      flattenInsert(e.name, e.x, e.y, parsed.blocks, 0, out);
    } else {
      const mapped = mapEntity(e, 0, 0);
      if (mapped) out.push(mapped);
    }
  }

  const sourceBBoxMm = computeBBox(out);
  return { name, entities: out, ...(sourceBBoxMm !== undefined ? { sourceBBoxMm } : {}) };
}
