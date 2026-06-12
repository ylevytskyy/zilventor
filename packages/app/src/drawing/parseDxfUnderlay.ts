// packages/app/src/drawing/parseDxfUnderlay.ts
// F1 (DXF underlay parser) — pure function; no side effects.
//
// NOTE on bulge/arc segments in LWPOLYLINE/POLYLINE:
//   Non-zero bulge values describe arc segments. For the MVP backdrop use-case,
//   these are approximated as straight chord segments (straight line from vertex
//   to vertex). This is intentional and documented as a known limitation.

import DxfParser from 'dxf-parser';
import type { IInsertEntity } from 'dxf-parser';
import type { IEntity } from 'dxf-parser/dist/entities/geomtry';
import type { ILineEntity } from 'dxf-parser/dist/entities/line';
import type { ILwpolylineEntity } from 'dxf-parser/dist/entities/lwpolyline';
import type { IPolylineEntity } from 'dxf-parser/dist/entities/polyline';
import type { ICircleEntity } from 'dxf-parser/dist/entities/circle';
import type { IArcEntity } from 'dxf-parser/dist/entities/arc';
import type { ITextEntity } from 'dxf-parser/dist/entities/text';
import type { IMtextEntity } from 'dxf-parser/dist/entities/mtext';
import type { IBlock, IDxf } from 'dxf-parser';
import type { UnderlayEntity, DxfUnderlay } from '@zilventor/shared';

// ---------------------------------------------------------------------------
// Entity mappers
// ---------------------------------------------------------------------------

function mapLine(e: ILineEntity, dx: number, dy: number): UnderlayEntity | null {
  const v = e.vertices;
  if (!v || v.length < 2) return null;
  const start = v[0]!;
  const end = v[1]!;
  return {
    kind: 'line',
    x1: (start.x ?? 0) + dx,
    y1: (start.y ?? 0) + dy,
    x2: (end.x ?? 0) + dx,
    y2: (end.y ?? 0) + dy,
  };
}

function mapLwPolyline(e: ILwpolylineEntity, dx: number, dy: number): UnderlayEntity | null {
  if (!e.vertices || e.vertices.length === 0) return null;
  const points: Array<readonly [number, number]> = e.vertices.map(
    (v) => [(v.x ?? 0) + dx, (v.y ?? 0) + dy] as const,
  );
  return { kind: 'polyline', points, closed: !!e.shape };
}

function mapPolyline(e: IPolylineEntity, dx: number, dy: number): UnderlayEntity | null {
  if (!e.vertices || e.vertices.length === 0) return null;
  const points: Array<readonly [number, number]> = e.vertices.map(
    (v) => [(v.x ?? 0) + dx, (v.y ?? 0) + dy] as const,
  );
  // POLYLINE closed flag: bit 0 of entity flag (shape = closed)
  const closed = !!e.shape;
  return { kind: 'polyline', points, closed };
}

function mapCircle(e: ICircleEntity, dx: number, dy: number): UnderlayEntity | null {
  const c = e.center;
  if (!c) return null;
  return {
    kind: 'circle',
    cx: (c.x ?? 0) + dx,
    cy: (c.y ?? 0) + dy,
    r: e.radius ?? 0,
  };
}

const RAD_TO_DEG = 180 / Math.PI;

function mapArc(e: IArcEntity, dx: number, dy: number): UnderlayEntity | null {
  const c = e.center;
  if (!c) return null;
  // dxf-parser converts DXF group-50/51 angles from degrees to radians.
  // We store angles in degrees (matching the UnderlayEntity spec and DXF convention).
  return {
    kind: 'arc',
    cx: (c.x ?? 0) + dx,
    cy: (c.y ?? 0) + dy,
    r: e.radius ?? 0,
    startAngle: (e.startAngle ?? 0) * RAD_TO_DEG,
    endAngle: (e.endAngle ?? 0) * RAD_TO_DEG,
  };
}

function mapText(e: ITextEntity, dx: number, dy: number): UnderlayEntity | null {
  const sp = e.startPoint;
  if (!sp) return null;
  return {
    kind: 'text',
    x: (sp.x ?? 0) + dx,
    y: (sp.y ?? 0) + dy,
    height: e.textHeight ?? 0,
    value: e.text ?? '',
    rotation: e.rotation ?? 0,
  };
}

function mapMtext(e: IMtextEntity, dx: number, dy: number): UnderlayEntity | null {
  const p = e.position;
  if (!p) return null;
  return {
    kind: 'text',
    x: (p.x ?? 0) + dx,
    y: (p.y ?? 0) + dy,
    height: e.height ?? 0,
    value: e.text ?? '',
    rotation: e.rotation ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Single-entity dispatcher (applies insert-level dx/dy offset)
// ---------------------------------------------------------------------------

function mapEntity(e: IEntity, dx: number, dy: number): UnderlayEntity | null {
  switch (e.type) {
    case 'LINE':       return mapLine(e as ILineEntity, dx, dy);
    case 'LWPOLYLINE': return mapLwPolyline(e as ILwpolylineEntity, dx, dy);
    case 'POLYLINE':   return mapPolyline(e as IPolylineEntity, dx, dy);
    case 'CIRCLE':     return mapCircle(e as ICircleEntity, dx, dy);
    case 'ARC':        return mapArc(e as IArcEntity, dx, dy);
    case 'TEXT':       return mapText(e as ITextEntity, dx, dy);
    case 'MTEXT':      return mapMtext(e as IMtextEntity, dx, dy);
    // SPLINE, ELLIPSE, DIMENSION, etc. are skipped silently.
    default:           return null;
  }
}

// ---------------------------------------------------------------------------
// Block flattening — handles INSERT entities.
// Applies insert's translation (position.x/y). For MVP, rotation and scale
// are NOT applied (an under-transformed backdrop beats an empty one). Note
// the caller processes top-level entities first, then recursively processes
// block child entities.
// ---------------------------------------------------------------------------

function flattenInsert(
  insert: IInsertEntity,
  blocks: Record<string, IBlock>,
  depth: number,
  out: UnderlayEntity[],
): void {
  if (depth > 4) return; // guard against pathological nesting
  const block = blocks[insert.name];
  if (!block || !Array.isArray(block.entities)) return;

  const dx = insert.position?.x ?? 0;
  const dy = insert.position?.y ?? 0;

  for (const child of block.entities) {
    if (child.type === 'INSERT') {
      // Nested block — recurse one level, accumulating offset.
      const nestedInsert = child as IInsertEntity;
      const nestedDx = dx + (nestedInsert.position?.x ?? 0);
      const nestedDy = dy + (nestedInsert.position?.y ?? 0);
      // Synthesize a shifted insert to pass accumulated offset.
      flattenInsert(
        { ...nestedInsert, position: { x: nestedDx, y: nestedDy, z: 0 } } as IInsertEntity,
        blocks,
        depth + 1,
        out,
      );
    } else {
      const mapped = mapEntity(child, dx, dy);
      if (mapped !== null) out.push(mapped);
    }
  }
}

// ---------------------------------------------------------------------------
// Bounding box computation
// ---------------------------------------------------------------------------

type BBox = { minX: number; minY: number; maxX: number; maxY: number };

function expandBBox(bb: BBox, x: number, y: number): void {
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
      case 'line':
        expandBBox(bb, e.x1, e.y1);
        expandBBox(bb, e.x2, e.y2);
        break;
      case 'polyline':
        for (const [px, py] of e.points) expandBBox(bb, px, py);
        break;
      case 'circle':
        expandBBox(bb, e.cx - e.r, e.cy - e.r);
        expandBBox(bb, e.cx + e.r, e.cy + e.r);
        break;
      case 'arc':
        // Approximate with center ± radius (conservative).
        expandBBox(bb, e.cx - e.r, e.cy - e.r);
        expandBBox(bb, e.cx + e.r, e.cy + e.r);
        break;
      case 'text':
        expandBBox(bb, e.x, e.y);
        break;
    }
  }

  if (!isFinite(bb.minX)) return undefined;
  return bb;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a DXF text string into a flat DxfUnderlay suitable for rendering as
 * a sheet backdrop in ZilInventor drawings.
 *
 * - All coordinates are preserved in the DXF file's unit (assumed mm when
 *   $INSUNITS is absent).
 * - INSERT / BLOCK references are flattened (translation applied; rotation and
 *   scale are deferred — an under-transformed backdrop beats an empty one).
 * - Malformed / headerless DXF → returns `{ name, entities: [] }`, never throws.
 */
export function parseDxfUnderlay(dxfText: string, fileName: string): DxfUnderlay {
  // Derive name: strip final extension only.
  const lastDot = fileName.lastIndexOf('.');
  const name = lastDot > 0 ? fileName.slice(0, lastDot) : fileName;

  let dxf: IDxf | null = null;
  try {
    const parser = new DxfParser();
    dxf = parser.parseSync(dxfText);
  } catch {
    // Malformed DXF → return empty underlay, never throw.
    return { name, entities: [] };
  }

  if (!dxf || !Array.isArray(dxf.entities)) {
    return { name, entities: [] };
  }

  const blocks: Record<string, IBlock> = dxf.blocks ?? {};
  const out: UnderlayEntity[] = [];

  for (const e of dxf.entities) {
    if (e.type === 'INSERT') {
      flattenInsert(e as IInsertEntity, blocks, 0, out);
    } else {
      const mapped = mapEntity(e, 0, 0);
      if (mapped !== null) out.push(mapped);
    }
  }

  const sourceBBoxMm = computeBBox(out);

  return { name, entities: out, ...(sourceBBoxMm !== undefined ? { sourceBBoxMm } : {}) };
}
