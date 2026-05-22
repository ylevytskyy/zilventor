// packages/app/src/drawing/DimensionElement.tsx
import type { DrawingDimension, DrawingView, DimensionGroup } from '@zilventor/shared';
import type { PointRef } from '@zilventor/shared/src/drawing/types';
import { useAppStore } from '../store/useAppStore';
import { resolveF5DimText } from './DimensionElementF5Utils';
import { intersectLines, subtendedAngle, formatAngleDeg } from '@zilventor/shared/src/drawing/dimensionMath';

// Resolve a PointRef to sheet-space mm coords within the view's projection.
function resolvePoint(ref: PointRef, view: DrawingView): { x: number; y: number } | null {
  const proj = view.projection;
  if (!proj) return null;
  const allEdges = [...proj.visibleEdges, ...proj.hiddenEdges];
  const edge = allEdges.find((e) => e.id === ref.edgeId);
  if (!edge || edge.points.length === 0) return null;
  const s = view.scale.numerator / view.scale.denominator;
  const px = view.positionMm.x;
  const py = view.positionMm.y;

  if (ref.kind === 'edge-endpoint') {
    const pt = ref.end === 'start' ? edge.points[0] : edge.points[edge.points.length - 1];
    if (!pt) return null;
    return { x: px + pt[0] * s, y: py + pt[1] * s };
  }
  if (ref.kind === 'edge-midpoint') {
    const mid = Math.floor(edge.points.length / 2);
    const pt = edge.points[mid];
    if (!pt) return null;
    return { x: px + pt[0] * s, y: py + pt[1] * s };
  }
  if (ref.kind === 'arc-center') {
    const sum = edge.points.reduce((acc, p) => ({ x: acc.x + p[0], y: acc.y + p[1] }), { x: 0, y: 0 });
    return { x: px + (sum.x / edge.points.length) * s, y: py + (sum.y / edge.points.length) * s };
  }
  return null;
}

function arrowHead(x1: number, y1: number, x2: number, y2: number, size = 2): string {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;
  const b1 = { x: x2 - ux * size + px * size * 0.5, y: y2 - uy * size + py * size * 0.5 };
  const b2 = { x: x2 - ux * size - px * size * 0.5, y: y2 - uy * size - py * size * 0.5 };
  return `M${b1.x},${b1.y} L${x2},${y2} L${b2.x},${b2.y}`;
}

type LinearDim = DrawingDimension & { kind: 'linear-h' | 'linear-v' | 'aligned' };

function LinearDimension({ dim, view }: { dim: LinearDim; view: DrawingView }) {
  const fromPt = resolvePoint(dim.from, view);
  const toPt   = resolvePoint(dim.to, view);
  if (!fromPt || !toPt) return null;

  const offset = dim.offsetMm;
  let dimFrom: { x: number; y: number };
  let dimTo:   { x: number; y: number };
  let measuredVal: number;

  if (dim.kind === 'linear-h') {
    dimFrom = { x: fromPt.x, y: fromPt.y - offset };
    dimTo   = { x: toPt.x,   y: fromPt.y - offset };
    measuredVal = Math.abs(toPt.x - fromPt.x);
  } else if (dim.kind === 'linear-v') {
    dimFrom = { x: fromPt.x - offset, y: fromPt.y };
    dimTo   = { x: fromPt.x - offset, y: toPt.y };
    measuredVal = Math.abs(toPt.y - fromPt.y);
  } else {
    // aligned: perpendicular offset
    const dx = toPt.x - fromPt.x, dy = toPt.y - fromPt.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len, ny = dx / len;
    dimFrom = { x: fromPt.x + nx * offset, y: fromPt.y + ny * offset };
    dimTo   = { x: toPt.x   + nx * offset, y: toPt.y   + ny * offset };
    measuredVal = len;
  }

  const midX = (dimFrom.x + dimTo.x) / 2;
  const midY = (dimFrom.y + dimTo.y) / 2 - 1.5;

  // F4: parametric text resolution — three-mode cascade (spec §7.1)
  let displayText: string;
  if ('textOverride' in dim && typeof dim.textOverride === 'string') {
    // Mode 1: user override — render verbatim
    displayText = dim.textOverride;
  } else if ('sourceParameterName' in dim && typeof dim.sourceParameterName === 'string') {
    // Mode 2: parametric — look up live parameter value from store.
    // Uses getState() (snapshot read) NOT useStore subscription on purpose: this
    // component re-renders whenever the parent DrawingCanvas re-renders on any
    // store change, so a subscription would be redundant and add render churn.
    const paramName = dim.sourceParameterName;
    const activePart = useAppStore.getState().activePart;
    const param = activePart?.parameters[paramName];
    displayText = param !== undefined
      ? String(Math.round(param.value * 10) / 10)
      : String(Math.round(measuredVal * 10) / 10);  // orphan fallback (F4.5)
  } else {
    // Mode 3: geometric (existing behavior, unchanged)
    displayText = String(Math.round(measuredVal * 10) / 10);
  }

  return (
    <g data-dim-id={dim.id}>
      {/* Extension lines */}
      <line x1={fromPt.x} y1={fromPt.y} x2={dimFrom.x} y2={dimFrom.y}
        stroke="#222" strokeWidth="0.18" />
      <line x1={toPt.x} y1={toPt.y} x2={dimTo.x} y2={dimTo.y}
        stroke="#222" strokeWidth="0.18" />
      {/* Dimension line */}
      <line x1={dimFrom.x} y1={dimFrom.y} x2={dimTo.x} y2={dimTo.y}
        stroke="#222" strokeWidth="0.25" />
      {/* Arrowheads */}
      <path d={arrowHead(dimTo.x, dimTo.y, dimFrom.x, dimFrom.y)} stroke="#222" strokeWidth="0.2" fill="none" />
      <path d={arrowHead(dimFrom.x, dimFrom.y, dimTo.x, dimTo.y)} stroke="#222" strokeWidth="0.2" fill="none" />
      {/* Text */}
      <text x={midX} y={midY} textAnchor="middle" fontSize={3.5} fill="#111"
        data-dim-text>
        {displayText}
      </text>
    </g>
  );
}

type RadialDim = DrawingDimension & { kind: 'radial' | 'diametric' };

function RadialOrDiametricDimension({ dim, view }: { dim: RadialDim; view: DrawingView }) {
  const proj = view.projection;
  if (!proj) return null;
  const allEdges = [...proj.visibleEdges, ...proj.hiddenEdges];
  const edge = allEdges.find((e) => e.id === dim.edgeId);
  if (!edge || edge.points.length === 0) return null;

  const s = view.scale.numerator / view.scale.denominator;
  const px = view.positionMm.x, py = view.positionMm.y;

  const sum = edge.points.reduce((acc, p) => ({ x: acc.x + p[0], y: acc.y + p[1] }), { x: 0, y: 0 });
  const cx = px + (sum.x / edge.points.length) * s;
  const cy = py + (sum.y / edge.points.length) * s;
  const first = edge.points[0]!;
  const radius = Math.sqrt((first[0] - sum.x / edge.points.length) ** 2 + (first[1] - sum.y / edge.points.length) ** 2) * s;

  const anglRad = (dim.angleDeg * Math.PI) / 180;
  const leaderEnd = {
    x: cx + Math.cos(anglRad) * (radius + dim.offsetMm),
    y: cy + Math.sin(anglRad) * (radius + dim.offsetMm),
  };
  const leaderStart = {
    x: cx + Math.cos(anglRad) * radius,
    y: cy + Math.sin(anglRad) * radius,
  };
  const textVal = Math.round(radius * 10) / 10;
  const prefix = dim.kind === 'radial' ? 'R' : 'Ø';

  return (
    <g data-dim-id={dim.id}>
      <line x1={leaderStart.x} y1={leaderStart.y} x2={leaderEnd.x} y2={leaderEnd.y}
        stroke="#222" strokeWidth="0.25" />
      <text x={leaderEnd.x + 1} y={leaderEnd.y} fontSize={3.5} fill="#111" data-dim-text>
        {`${prefix}${textVal}`}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// getDimensionGroupForDim — reads from store via getState() snapshot.
//
// F4 cascade gotcha: NO useStore subscription here. DrawingCanvas re-renders
// on every store change so this is called fresh each render. A subscription
// would be redundant and add render churn. See DimensionElement.tsx lines
// 87-93 for the same getState() pattern used by LinearDimension.
// ---------------------------------------------------------------------------
function getDimensionGroupForDim(dim: { groupId: string }): DimensionGroup | null {
  const { activeDrawing } = useAppStore.getState();
  if (!activeDrawing) return null;
  const sheet = activeDrawing.sheets.find((s) => s.id === activeDrawing.activeSheetId) ?? activeDrawing.sheets[0];
  if (!sheet) return null;
  return (sheet.dimensionGroups ?? []).find((g) => g.id === dim.groupId) ?? null;
}

// ---------------------------------------------------------------------------
// BaselineDimension
// ---------------------------------------------------------------------------

type BaselineDim = DrawingDimension & { kind: 'baseline' };

function BaselineDimension({ dim, view, group }: { dim: BaselineDim; view: DrawingView; group: DimensionGroup & { kind: 'baseline' } }) {
  if (!view.projection) return null;

  const allEdges = [...view.projection.visibleEdges, ...view.projection.hiddenEdges];

  const datumEdge = allEdges.find((e) => e.id === group.datum.edgeId);
  const toEdge    = allEdges.find((e) => e.id === dim.to.edgeId);
  if (!datumEdge || !toEdge || datumEdge.points.length === 0 || toEdge.points.length === 0) return null;

  const s  = view.scale.numerator / view.scale.denominator;
  const vx = view.positionMm.x;
  const vy = view.positionMm.y;

  // Resolve datum and to points in sheet-space mm
  const datumPtRaw = group.direction === 'h'
    ? datumEdge.points[group.datum.kind === 'edge-endpoint' && (group.datum as PointRef & { end: string }).end === 'end' ? datumEdge.points.length - 1 : 0]!
    : datumEdge.points[group.datum.kind === 'edge-endpoint' && (group.datum as PointRef & { end: string }).end === 'end' ? datumEdge.points.length - 1 : 0]!;
  const toPtRaw = toEdge.points[dim.to.kind === 'edge-endpoint' && (dim.to as PointRef & { end: string }).end === 'end' ? toEdge.points.length - 1 : 0]!;

  const dx = vx + datumPtRaw[0] * s;
  const dy = vy + datumPtRaw[1] * s;
  const tx = vx + toPtRaw[0] * s;
  const ty = vy + toPtRaw[1] * s;

  const offset = group.baseOffsetMm + dim.slot * group.spacingMm;

  let distMm: number;
  let dimLine: React.ReactNode;
  let ext1: React.ReactNode;
  let ext2: React.ReactNode;
  let textX: number;
  let textY: number;

  if (group.direction === 'h') {
    const dimY = dy - offset;
    distMm = Math.round(Math.abs(toPtRaw[0] - datumPtRaw[0]));
    ext1 = <line x1={dx} y1={dy} x2={dx} y2={dimY} stroke="#00c" strokeWidth="0.2" fill="none" />;
    ext2 = <line x1={tx} y1={ty} x2={tx} y2={dimY} stroke="#00c" strokeWidth="0.2" fill="none" />;
    dimLine = <line x1={dx} y1={dimY} x2={tx} y2={dimY} stroke="#00c" strokeWidth="0.2" fill="none" />;
    textX = (dx + tx) / 2;
    textY = dimY - 1;
  } else {
    const dimX = dx + offset;
    distMm = Math.round(Math.abs(toPtRaw[1] - datumPtRaw[1]));
    ext1 = <line x1={dx} y1={dy} x2={dimX} y2={dy} stroke="#00c" strokeWidth="0.2" fill="none" />;
    ext2 = <line x1={tx} y1={ty} x2={dimX} y2={ty} stroke="#00c" strokeWidth="0.2" fill="none" />;
    dimLine = <line x1={dimX} y1={dy} x2={dimX} y2={ty} stroke="#00c" strokeWidth="0.2" fill="none" />;
    textX = dx + offset + 1;
    textY = (dy + ty) / 2;
  }

  const displayText = resolveF5DimText(dim, distMm);

  return (
    <g data-dim-id={dim.id} data-dim-kind="baseline" data-group-id={group.id} data-slot={dim.slot}>
      {ext1}
      {ext2}
      {dimLine}
      <text x={textX} y={textY} fontSize={3.5} fill="#00c" textAnchor="middle" stroke="none">
        {displayText}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// OrdinateDimension
// ---------------------------------------------------------------------------

type OrdinateDim = DrawingDimension & { kind: 'ordinate' };

function OrdinateDimension({ dim, view, group }: { dim: OrdinateDim; view: DrawingView; group: DimensionGroup & { kind: 'ordinate' } }) {
  if (!view.projection) return null;

  const allEdges = [...view.projection.visibleEdges, ...view.projection.hiddenEdges];

  const originEdge = allEdges.find((e) => e.id === group.origin.edgeId);
  const toEdge     = allEdges.find((e) => e.id === dim.to.edgeId);
  if (!originEdge || !toEdge || originEdge.points.length === 0 || toEdge.points.length === 0) return null;

  const s  = view.scale.numerator / view.scale.denominator;
  const vx = view.positionMm.x;
  const vy = view.positionMm.y;

  const originPtRaw = originEdge.points[group.origin.kind === 'edge-endpoint' && (group.origin as PointRef & { end: string }).end === 'end' ? originEdge.points.length - 1 : 0]!;
  const toPtRaw     = toEdge.points[dim.to.kind === 'edge-endpoint' && (dim.to as PointRef & { end: string }).end === 'end' ? toEdge.points.length - 1 : 0]!;

  const ox = vx + originPtRaw[0] * s;
  const oy = vy + originPtRaw[1] * s;
  const tx = vx + toPtRaw[0] * s;
  const ty = vy + toPtRaw[1] * s;

  let leg1x1: number, leg1y1: number, leg1x2: number, leg1y2: number;
  let leg2x1: number, leg2y1: number, leg2x2: number, leg2y2: number;
  let textX: number;
  let textY: number;
  let delta: number;

  if (dim.axis === 'x') {
    const colY = oy + group.xColumnOffsetMm;
    leg1x1 = tx; leg1y1 = ty; leg1x2 = tx; leg1y2 = colY;
    leg2x1 = tx; leg2y1 = colY; leg2x2 = ox; leg2y2 = colY;
    textX = ox - 1; textY = colY - 1;
    delta = toPtRaw[0] - originPtRaw[0];
  } else {
    const colX = ox + group.yColumnOffsetMm;
    leg1x1 = tx; leg1y1 = ty; leg1x2 = colX; leg1y2 = ty;
    leg2x1 = colX; leg2y1 = ty; leg2x2 = colX; leg2y2 = oy;
    textX = colX + 1; textY = oy - 1;
    delta = toPtRaw[1] - originPtRaw[1];
  }

  const displayText = resolveF5DimText(dim, Math.abs(delta));

  return (
    <g data-dim-id={dim.id} data-dim-kind="ordinate" data-group-id={group.id} data-axis={dim.axis}>
      <line x1={leg1x1} y1={leg1y1} x2={leg1x2} y2={leg1y2} stroke="#00c" strokeWidth="0.2" fill="none" />
      <line x1={leg2x1} y1={leg2y1} x2={leg2x2} y2={leg2y2} stroke="#00c" strokeWidth="0.2" fill="none" />
      <text x={textX} y={textY} fontSize={3.5} fill="#00c" stroke="none">
        {displayText}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// AngularDimension
// ---------------------------------------------------------------------------

type AngularDim = DrawingDimension & { kind: 'angular' };

function normalizeAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r < 0) r += 2 * Math.PI;
  return r;
}

function circumcenterX(
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
): number {
  const ax = p0[0], ay = p0[1];
  const bx = p1[0], by = p1[1];
  const cx = p2[0], cy = p2[1];
  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(D) < 1e-12) return (ax + bx + cx) / 3;
  return ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
}

function circumcenterY(
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
): number {
  const ax = p0[0], ay = p0[1];
  const bx = p1[0], by = p1[1];
  const cx = p2[0], cy = p2[1];
  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(D) < 1e-12) return (ay + by + cy) / 3;
  return ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;
}

function distSqPt(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function unitVec(v: { x: number; y: number }): { x: number; y: number } {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  if (len < 1e-12) return { x: 1, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

function AngularDimension({ dim, view }: { dim: AngularDim; view: DrawingView }) {
  if (!view.projection) return null;

  const s  = view.scale.numerator / view.scale.denominator;
  const vx = view.positionMm.x;
  const vy = view.positionMm.y;
  const ref = dim.ref;

  if (ref.kind === 'arc') {
    const arcEdge = view.projection.visibleEdges.find((e) => e.id === ref.edge.edgeId)
      ?? view.projection.hiddenEdges.find((e) => e.id === ref.edge.edgeId);
    if (!arcEdge || arcEdge.points.length < 3) return null;

    const pts = arcEdge.points;
    const pStart = pts[0]!;
    const pEnd   = pts[pts.length - 1]!;
    const pMid   = pts[Math.floor(pts.length / 2)]!;

    const cx_arc = circumcenterX(pStart, pMid, pEnd);
    const cy_arc = circumcenterY(pStart, pMid, pEnd);
    const r_arc  = Math.sqrt((pStart[0] - cx_arc) ** 2 + (pStart[1] - cy_arc) ** 2);

    const startAngle = Math.atan2(pStart[1] - cy_arc, pStart[0] - cx_arc);
    const endAngle   = Math.atan2(pEnd[1]   - cy_arc, pEnd[0]   - cx_arc);

    const arcR = r_arc + dim.offsetMm;
    const insideSweepRad = normalizeAngle(endAngle - startAngle);
    const isOutside = dim.arcSide === 'outside';
    const sweepRad  = isOutside ? 2 * Math.PI - insideSweepRad : insideSweepRad;

    const asx = vx + (cx_arc + arcR * Math.cos(startAngle)) * s;
    const asy = vy + (cy_arc + arcR * Math.sin(startAngle)) * s;
    const aex = vx + (cx_arc + arcR * Math.cos(endAngle)) * s;
    const aey = vy + (cy_arc + arcR * Math.sin(endAngle)) * s;

    const largeArc  = sweepRad > Math.PI ? 1 : 0;
    const sweepFlag = isOutside ? 0 : 1;
    const arcRScaled = arcR * s;

    const midAngle = isOutside
      ? startAngle - (2 * Math.PI - insideSweepRad) / 2
      : startAngle + insideSweepRad / 2;
    const textX = vx + (cx_arc + (arcR + 1.5) * Math.cos(midAngle)) * s;
    const textY = vy + (cy_arc + (arcR + 1.5) * Math.sin(midAngle)) * s;
    const label = resolveF5DimText(dim, (sweepRad * 180) / Math.PI);
    const arcLabel = formatAngleDeg(sweepRad);
    const displayLabel = label !== String(Math.round((sweepRad * 180) / Math.PI * 10) / 10)
      ? label  // cascade override or param value
      : arcLabel;  // geometric: use degree symbol form

    return (
      <g data-dim-id={dim.id} data-dim-kind="angular" data-arc-side={dim.arcSide}>
        <path d={`M ${asx} ${asy} A ${arcRScaled} ${arcRScaled} 0 ${largeArc} ${sweepFlag} ${aex} ${aey}`}
          stroke="#00c" strokeWidth="0.2" fill="none" />
        <text x={textX} y={textY} fontSize={3.5} textAnchor="middle" fill="#00c" stroke="none">
          {displayLabel}
        </text>
      </g>
    );
  }

  // two-edges case
  const edge1 = view.projection.visibleEdges.find((e) => e.id === ref.edge1.edgeId)
    ?? view.projection.hiddenEdges.find((e) => e.id === ref.edge1.edgeId);
  const edge2 = view.projection.visibleEdges.find((e) => e.id === ref.edge2.edgeId)
    ?? view.projection.hiddenEdges.find((e) => e.id === ref.edge2.edgeId);
  if (!edge1 || !edge2 || edge1.points.length < 2 || edge2.points.length < 2) return null;

  const e1p0 = { x: edge1.points[0]![0], y: edge1.points[0]![1] };
  const e1p1 = { x: edge1.points[edge1.points.length - 1]![0], y: edge1.points[edge1.points.length - 1]![1] };
  const e2p0 = { x: edge2.points[0]![0], y: edge2.points[0]![1] };
  const e2p1 = { x: edge2.points[edge2.points.length - 1]![0], y: edge2.points[edge2.points.length - 1]![1] };

  const apex = intersectLines({ p0: e1p0, p1: e1p1 }, { p0: e2p0, p1: e2p1 });

  if (!apex) {
    // Parallel edges fallback
    const midX = vx + ((e1p0.x + e1p1.x + e2p0.x + e2p1.x) / 4) * s;
    const midY = vy + ((e1p0.y + e1p1.y + e2p0.y + e2p1.y) / 4) * s;
    return (
      <g data-dim-id={dim.id} data-dim-kind="angular" data-arc-side={dim.arcSide}>
        <text x={midX} y={midY} fontSize={3.5} textAnchor="middle" fill="#00c" stroke="none">—</text>
      </g>
    );
  }

  const e1FarPt = distSqPt(e1p0, apex) >= distSqPt(e1p1, apex) ? e1p0 : e1p1;
  const e2FarPt = distSqPt(e2p0, apex) >= distSqPt(e2p1, apex) ? e2p0 : e2p1;
  const d1 = unitVec({ x: e1FarPt.x - apex.x, y: e1FarPt.y - apex.y });
  const d2 = unitVec({ x: e2FarPt.x - apex.x, y: e2FarPt.y - apex.y });

  const { insideRad, outsideRad } = subtendedAngle(d1, d2);
  const sweepRad = dim.arcSide === 'inside' ? insideRad : outsideRad;
  const label    = formatAngleDeg(sweepRad);

  const startAngle = Math.atan2(d1.y, d1.x);
  const endAngle   = Math.atan2(d2.y, d2.x);
  const arcR       = dim.offsetMm;
  const arcRScaled = arcR * s;

  const apexSvgX = vx + apex.x * s;
  const apexSvgY = vy + apex.y * s;

  const asx = apexSvgX + arcRScaled * Math.cos(startAngle);
  const asy = apexSvgY + arcRScaled * Math.sin(startAngle);
  const aex = apexSvgX + arcRScaled * Math.cos(endAngle);
  const aey = apexSvgY + arcRScaled * Math.sin(endAngle);

  const largeArc = sweepRad > Math.PI ? 1 : 0;
  const cross     = d1.x * d2.y - d1.y * d2.x;
  const sweepFlag = dim.arcSide === 'inside'
    ? (cross > 0 ? 1 : 0)
    : (cross > 0 ? 0 : 1);

  const midAngle = startAngle + (dim.arcSide === 'inside' ? insideRad : outsideRad) / 2;
  const textR  = arcR + 1.5;
  const textX  = apexSvgX + textR * s * Math.cos(midAngle);
  const textY  = apexSvgY + textR * s * Math.sin(midAngle);

  const displayText = resolveF5DimText(dim, (sweepRad * 180) / Math.PI);
  // Use degree-symbol format if not overridden
  const displayLabel = displayText === String(Math.round((sweepRad * 180) / Math.PI * 10) / 10)
    ? label  // geometric: use degree symbol form
    : displayText;  // cascade override or param value

  return (
    <g data-dim-id={dim.id} data-dim-kind="angular" data-arc-side={dim.arcSide}>
      <path d={`M ${asx} ${asy} A ${arcRScaled} ${arcRScaled} 0 ${largeArc} ${sweepFlag} ${aex} ${aey}`}
        stroke="#00c" strokeWidth="0.2" fill="none" />
      <text x={textX} y={textY} fontSize={3.5} textAnchor="middle" fill="#00c" stroke="none">
        {displayLabel}
      </text>
    </g>
  );
}

export type DimensionElementProps = {
  dim: DrawingDimension;
  view: DrawingView;
};

export function DimensionElement({ dim, view }: DimensionElementProps) {
  switch (dim.kind) {
    case 'linear-h':
    case 'linear-v':
    case 'aligned':
      return <LinearDimension dim={dim} view={view} />;
    case 'radial':
    case 'diametric':
      return <RadialOrDiametricDimension dim={dim} view={view} />;
    case 'baseline': {
      // STRUCTURAL DEPENDENCY: getDimensionGroupForDim uses getState() snapshot,
      // NOT useStore subscription. DrawingCanvas re-renders on every store change
      // so this component is re-called on each render — subscription would be
      // redundant and add render churn. See F4 cascade gotcha in lines 87-97 and
      // getDimensionGroupForDim comment above.
      const bgGroup = getDimensionGroupForDim(dim);
      if (!bgGroup || bgGroup.kind !== 'baseline') return null;
      return <BaselineDimension dim={dim} view={view} group={bgGroup} />;
    }
    case 'ordinate': {
      // Same getState() snapshot pattern — no useStore subscription.
      const ogGroup = getDimensionGroupForDim(dim);
      if (!ogGroup || ogGroup.kind !== 'ordinate') return null;
      return <OrdinateDimension dim={dim} view={view} group={ogGroup} />;
    }
    case 'angular':
      return <AngularDimension dim={dim} view={view} />;
    default:
      return null;
  }
}
