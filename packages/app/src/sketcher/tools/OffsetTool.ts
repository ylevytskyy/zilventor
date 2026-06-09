import type { SketchPrimitive } from '@zilventor/shared';
import type { Point2 } from '../snap';
import { pickPrimitiveAt } from './pick';
import { offsetPrimitive, findChain, offsetChain } from '../geometry/offset';

type State = { kind: 'idle' } | { kind: 'picked'; primitiveId: string; lastSignedDist: number };

/**
 * Samples a SketchPrimitive as a polyline for preview.
 * Returns an array of {x,y} points representing the shape.
 */
function samplePrimitive(p: SketchPrimitive): Point2[] {
  if (p.kind === 'line') {
    return [{ x: p.x1, y: p.y1 }, { x: p.x2, y: p.y2 }];
  }
  if (p.kind === 'circle') {
    const pts: Point2[] = [];
    const N = 32;
    for (let i = 0; i <= N; i++) {
      const a = (2 * Math.PI * i) / N;
      pts.push({ x: p.cx + p.r * Math.cos(a), y: p.cy + p.r * Math.sin(a) });
    }
    return pts;
  }
  if (p.kind === 'arc') {
    const pts: Point2[] = [];
    const N = 16;
    const span = p.endAngle - p.startAngle;
    for (let i = 0; i <= N; i++) {
      const a = p.startAngle + (span * i) / N;
      pts.push({ x: p.cx + p.r * Math.cos(a), y: p.cy + p.r * Math.sin(a) });
    }
    return pts;
  }
  if (p.kind === 'rectangle') {
    return [
      { x: p.x,          y: p.y },
      { x: p.x + p.w,   y: p.y },
      { x: p.x + p.w,   y: p.y + p.h },
      { x: p.x,          y: p.y + p.h },
      { x: p.x,          y: p.y },
    ];
  }
  return [];
}

/**
 * Computes the signed perpendicular distance from `cursor` to the given primitive.
 *
 * Convention matches offsetPrimitive's +d = left of line direction / outward for circle/arc / outward for rect:
 * - line: project cursor onto normal (-dy,dx)/len; positive = left of travel
 * - circle/arc: hypot(cursor-center) - r; positive = outside
 * - rectangle: signed distance to nearest edge; positive = outside
 */
function signedDist(prim: SketchPrimitive, cursor: Point2): number {
  if (prim.kind === 'line') {
    const dx = prim.x2 - prim.x1, dy = prim.y2 - prim.y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return 0;
    // normal = (-dy, dx) / len  (left of direction = positive)
    const nx = -dy / len, ny = dx / len;
    return (cursor.x - prim.x1) * nx + (cursor.y - prim.y1) * ny;
  }
  if (prim.kind === 'circle' || prim.kind === 'arc') {
    return Math.hypot(cursor.x - prim.cx, cursor.y - prim.cy) - prim.r;
  }
  if (prim.kind === 'rectangle') {
    // Signed distance: negative inside, positive outside.
    // Compute distance to each of the 4 edges (as a clamped signed measure).
    const { x, y, w, h } = prim;
    const dx = Math.min(cursor.x - x, x + w - cursor.x);
    const dy = Math.min(cursor.y - y, y + h - cursor.y);
    const inside = cursor.x >= x && cursor.x <= x + w && cursor.y >= y && cursor.y <= y + h;
    if (inside) {
      // Distance to nearest edge, negative (inside)
      return -Math.min(dx, dy);
    } else {
      // Outside: positive distance
      const ox = Math.max(0, Math.max(x - cursor.x, cursor.x - (x + w)));
      const oy = Math.max(0, Math.max(y - cursor.y, cursor.y - (y + h)));
      return Math.hypot(ox, oy);
    }
  }
  return 0;
}

export class OffsetTool {
  private primitives: SketchPrimitive[] = [];
  private state: State = { kind: 'idle' };

  constructor(private opts: {
    onCommit: (p: SketchPrimitive) => void;
    onPreview: (poly: Point2[]) => void;
  }) {}

  setPrimitives(p: SketchPrimitive[]): void {
    this.primitives = p;
  }

  onPointerClick(pt: Point2): void {
    if (this.state.kind === 'idle') {
      const hit = pickPrimitiveAt(this.primitives, pt);
      if (!hit) return;
      this.state = { kind: 'picked', primitiveId: hit.primitiveId, lastSignedDist: 0 };
    } else {
      // Commit at the current cursor position
      this._commitAtDist(this.state.lastSignedDist);
    }
  }

  onPointerMove(pt: Point2): void {
    if (this.state.kind !== 'picked') return;
    const picked = this.state;
    const prim = this.primitives.find(p => p.id === picked.primitiveId);
    if (!prim) return;
    const d = signedDist(prim, pt);
    picked.lastSignedDist = d;
    const offsetted = offsetPrimitive(prim, d);
    if (offsetted) this.opts.onPreview(samplePrimitive(offsetted));
  }

  onNumericCommit(values: number[]): void {
    if (this.state.kind !== 'picked') return;
    const dist = values[0];
    if (dist === undefined) return;
    // Use the sign from the current cursor side
    const sign = this.state.lastSignedDist >= 0 ? 1 : -1;
    this._commitAtDist(sign * Math.abs(dist));
  }

  onEscapePressed(): void {
    this.state = { kind: 'idle' };
    this.opts.onPreview([]);
  }

  getAnchor(): Point2 | null {
    return null;
  }

  numericFieldCount(): number {
    return 1;
  }

  private _commitAtDist(d: number): void {
    if (this.state.kind !== 'picked') return;
    const prim = this.primitives.find(
      (p) => p.id === (this.state as { kind: 'picked'; primitiveId: string }).primitiveId,
    );
    if (!prim) return;

    const chain = findChain(prim, this.primitives);
    if (chain.length > 1) {
      // Multi-segment path: offset the whole chain and emit all results.
      const results = offsetChain(chain, d);
      for (const r of results) this.opts.onCommit(r);
    } else {
      // Single-primitive path (preserved from slice 1).
      const offsetted = offsetPrimitive(prim, d);
      if (offsetted) this.opts.onCommit(offsetted);
    }
    this.state = { kind: 'idle' };
    this.opts.onPreview([]);
  }
}
