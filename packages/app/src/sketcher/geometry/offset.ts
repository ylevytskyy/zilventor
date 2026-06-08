import type { SketchPrimitive } from '@zilventor/shared';

export function offsetPrimitive(p: SketchPrimitive, d: number): SketchPrimitive | null {
  const id = `p-off-${Math.random().toString(36).slice(2, 8)}`;
  if (p.kind === 'line') {
    const dx = p.x2 - p.x1, dy = p.y2 - p.y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return null;
    const nx = -dy / len, ny = dx / len;
    return { id, kind: 'line', x1: p.x1 + nx * d, y1: p.y1 + ny * d, x2: p.x2 + nx * d, y2: p.y2 + ny * d };
  }
  if (p.kind === 'circle') {
    const r = p.r + d;
    if (r <= 1e-6) return null;
    return { id, kind: 'circle', cx: p.cx, cy: p.cy, r };
  }
  if (p.kind === 'arc') {
    const r = p.r + d;
    if (r <= 1e-6) return null;
    return { id, kind: 'arc', cx: p.cx, cy: p.cy, r, startAngle: p.startAngle, endAngle: p.endAngle };
  }
  if (p.kind === 'rectangle') {
    const nx = p.x - d, ny = p.y - d, nw = p.w + 2 * d, nh = p.h + 2 * d;
    if (nw <= 1e-6 || nh <= 1e-6) return null;
    return { id, kind: 'rectangle', x: nx, y: ny, w: nw, h: nh };
  }
  return null; // spline offset out of scope for slice 1
}
