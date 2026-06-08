import type { SketchPrimitive } from '@zilventor/shared';

type Line = Extract<SketchPrimitive, { kind: 'line' }>;
type Pt = { x: number; y: number };

export type FilletResult = {
  corner: Pt;
  center: Pt;
  radius: number;
  t1: Pt;
  t2: Pt;
  arc: Extract<SketchPrimitive, { kind: 'arc' }>;
  trimmedL1: Line;
  trimmedL2: Line;
};

export type ChamferResult = {
  corner: Pt;
  p1: Pt;
  p2: Pt;
  line: Line;
  trimmedL1: Line;
  trimmedL2: Line;
  /** Which endpoint of l1 was at the corner — 'start' = x1/y1, 'end' = x2/y2 */
  l1CornerAnchor: 'start' | 'end';
  /** Which endpoint of l2 was at the corner */
  l2CornerAnchor: 'start' | 'end';
};

const TOL = 1e-6;

function sharedCorner(a: Line, b: Line) {
  const aEnds = [
    { p: { x: a.x1, y: a.y1 }, start: true },
    { p: { x: a.x2, y: a.y2 }, start: false },
  ];
  const bEnds = [
    { p: { x: b.x1, y: b.y1 }, start: true },
    { p: { x: b.x2, y: b.y2 }, start: false },
  ];
  for (const ae of aEnds) {
    for (const be of bEnds) {
      if (Math.hypot(ae.p.x - be.p.x, ae.p.y - be.p.y) < 1e-4) {
        const aFar = aEnds.find((e) => e !== ae)!.p;
        const bFar = bEnds.find((e) => e !== be)!.p;
        return {
          corner: ae.p,
          aFar,
          bFar,
          aCornerIsStart: ae.start,
          bCornerIsStart: be.start,
        };
      }
    }
  }
  return null;
}

export function computeFillet(a: Line, b: Line, radius: number): FilletResult | null {
  if (radius <= TOL) return null;
  const sc = sharedCorner(a, b);
  if (!sc) return null;
  const { corner, aFar, bFar, aCornerIsStart, bCornerIsStart } = sc;

  const d1 = norm({ x: aFar.x - corner.x, y: aFar.y - corner.y });
  const d2 = norm({ x: bFar.x - corner.x, y: bFar.y - corner.y });
  if (!d1 || !d2) return null;

  const cosT = clamp(d1.x * d2.x + d1.y * d2.y, -1, 1);
  const theta = Math.acos(cosT);
  if (theta < 1e-3 || Math.PI - theta < 1e-3) return null;

  const half = theta / 2;
  const tanDist = radius / Math.tan(half);
  const cenDist = radius / Math.sin(half);

  const len1 = dist(corner, aFar);
  const len2 = dist(corner, bFar);
  if (tanDist > len1 - TOL || tanDist > len2 - TOL) return null;

  const t1 = { x: corner.x + d1.x * tanDist, y: corner.y + d1.y * tanDist };
  const t2 = { x: corner.x + d2.x * tanDist, y: corner.y + d2.y * tanDist };

  const bis = norm({ x: d1.x + d2.x, y: d1.y + d2.y })!;
  const center = { x: corner.x + bis.x * cenDist, y: corner.y + bis.y * cenDist };

  let a1 = Math.atan2(t1.y - center.y, t1.x - center.x);
  let a2 = Math.atan2(t2.y - center.y, t2.x - center.x);

  // Ensure we pick the short arc (the one that faces the corner, not the far side).
  // Normalize so |a2 - a1| <= π — this selects the minor arc.
  if (a2 - a1 > Math.PI) a2 -= 2 * Math.PI;
  if (a1 - a2 > Math.PI) a1 -= 2 * Math.PI;

  const arc: Extract<SketchPrimitive, { kind: 'arc' }> = {
    id: `p-fil-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'arc',
    cx: center.x,
    cy: center.y,
    r: radius,
    startAngle: a1,
    endAngle: a2,
  };

  const trimmedL1 = setCornerEndpoint(a, aCornerIsStart, t1);
  const trimmedL2 = setCornerEndpoint(b, bCornerIsStart, t2);

  return { corner, center, radius, t1, t2, arc, trimmedL1, trimmedL2 };
}

function setCornerEndpoint(l: Line, cornerIsStart: boolean, p: Pt): Line {
  return cornerIsStart ? { ...l, x1: p.x, y1: p.y } : { ...l, x2: p.x, y2: p.y };
}

const norm = (v: Pt): Pt | null => {
  const m = Math.hypot(v.x, v.y);
  return m < TOL ? null : { x: v.x / m, y: v.y / m };
};

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function computeChamfer(a: Line, b: Line, setback: number): ChamferResult | null {
  if (setback <= TOL) return null;
  const sc = sharedCorner(a, b);
  if (!sc) return null;
  const { corner, aFar, bFar, aCornerIsStart, bCornerIsStart } = sc;

  const d1 = norm({ x: aFar.x - corner.x, y: aFar.y - corner.y });
  const d2 = norm({ x: bFar.x - corner.x, y: bFar.y - corner.y });
  if (!d1 || !d2) return null;

  const len1 = dist(corner, aFar);
  const len2 = dist(corner, bFar);
  if (setback > len1 - TOL || setback > len2 - TOL) return null;

  const p1: Pt = { x: corner.x + d1.x * setback, y: corner.y + d1.y * setback };
  const p2: Pt = { x: corner.x + d2.x * setback, y: corner.y + d2.y * setback };

  const line: Line = {
    id: `p-cha-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'line',
    x1: p1.x,
    y1: p1.y,
    x2: p2.x,
    y2: p2.y,
  };

  const trimmedL1 = setCornerEndpoint(a, aCornerIsStart, p1);
  const trimmedL2 = setCornerEndpoint(b, bCornerIsStart, p2);

  return {
    corner,
    p1,
    p2,
    line,
    trimmedL1,
    trimmedL2,
    l1CornerAnchor: aCornerIsStart ? 'start' : 'end',
    l2CornerAnchor: bCornerIsStart ? 'start' : 'end',
  };
}
