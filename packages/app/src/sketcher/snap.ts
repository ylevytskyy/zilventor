import type { SketchPrimitive } from '@zilventor/shared';

export type Point2 = { x: number; y: number };
export type SnapKind = 'none' | 'endpoint' | 'horizontal-axis' | 'vertical-axis';
export type SnapResult = { point: Point2; kind: SnapKind };

export type SnapContext = {
  primitives: ReadonlyArray<SketchPrimitive>;
  pixelTolerance: number; // world units (mm) at the current zoom — caller converts
  anchor?: Point2;
};

const AXIS_SNAP_DEGREES = 3;

function primitiveEndpoints(p: SketchPrimitive): Point2[] {
  switch (p.kind) {
    case 'line':
      return [{ x: p.x1, y: p.y1 }, { x: p.x2, y: p.y2 }];
    case 'rectangle':
      return [
        { x: p.x, y: p.y },
        { x: p.x + p.w, y: p.y },
        { x: p.x + p.w, y: p.y + p.h },
        { x: p.x, y: p.y + p.h }
      ];
    case 'circle':
      return [{ x: p.cx + p.r, y: p.cy }];
    case 'arc':
      return [
        { x: p.cx + p.r * Math.cos(p.startAngle), y: p.cy + p.r * Math.sin(p.startAngle) },
        { x: p.cx + p.r * Math.cos(p.endAngle),   y: p.cy + p.r * Math.sin(p.endAngle)   }
      ];
    case 'spline':
      if (p.controlPoints.length === 0) return [];
      return [p.controlPoints[0]!, p.controlPoints[p.controlPoints.length - 1]!];
    case 'ellipse': {
      const cr = Math.cos(p.rotation), sr = Math.sin(p.rotation);
      const pt = (lx: number, ly: number) => ({ x: p.cx + lx * cr - ly * sr, y: p.cy + lx * sr + ly * cr });
      if (p.startAngle !== undefined && p.endAngle !== undefined) {
        return [
          pt(p.rx * Math.cos(p.startAngle), p.ry * Math.sin(p.startAngle)),
          pt(p.rx * Math.cos(p.endAngle), p.ry * Math.sin(p.endAngle)),
        ];
      }
      // Full ellipse: expose major-axis endpoint (mirrors circle's single snap point)
      return [{ x: p.cx + p.rx * cr, y: p.cy + p.rx * sr }];
    }
  }
}

function dist2(a: Point2, b: Point2): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function resolveSnap(cursor: Point2, ctx: SnapContext): SnapResult {
  // Pass 1: endpoint snap
  const tolSq = ctx.pixelTolerance * ctx.pixelTolerance;
  let bestDist = Infinity;
  let bestPt: Point2 | null = null;
  for (const p of ctx.primitives) {
    for (const ep of primitiveEndpoints(p)) {
      const d = dist2(cursor, ep);
      if (d < tolSq && d < bestDist) {
        bestDist = d;
        bestPt = ep;
      }
    }
  }
  if (bestPt) return { point: bestPt, kind: 'endpoint' };

  // Pass 2: axis snap from anchor
  if (ctx.anchor) {
    const dx = cursor.x - ctx.anchor.x;
    const dy = cursor.y - ctx.anchor.y;
    const distFromAnchor = Math.hypot(dx, dy);
    if (distFromAnchor > 0) {
      const angleRad = Math.atan2(dy, dx);
      const angleDeg = (angleRad * 180) / Math.PI;
      const tolDeg = AXIS_SNAP_DEGREES;
      const horizontalErr = Math.min(Math.abs(angleDeg), Math.abs(180 - Math.abs(angleDeg)));
      const verticalErr = Math.abs(90 - Math.abs(angleDeg));
      if (horizontalErr < verticalErr && horizontalErr <= tolDeg) {
        return { point: { x: cursor.x, y: ctx.anchor.y }, kind: 'horizontal-axis' };
      }
      if (verticalErr <= tolDeg) {
        return { point: { x: ctx.anchor.x, y: cursor.y }, kind: 'vertical-axis' };
      }
    }
  }
  return { point: cursor, kind: 'none' };
}
