// packages/app/src/drawing/DimensionElement.tsx
import type { DrawingDimension, DrawingView } from '@zilventor/shared';
import type { PointRef } from '@zilventor/shared/src/drawing/types';
import { useAppStore } from '../store/useAppStore';

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
    case 'baseline':
    case 'ordinate':
    case 'angular':
      // Rendering delegated to renderDrawingSvg.ts (Batch 1+3).
      // Cascade text is resolved via resolveF5DimText (DimensionElementF5Utils.ts)
      // when those renderers run.
      //
      // STRUCTURAL DEPENDENCY: Do NOT add useStore subscriptions here or in
      // resolveF5DimText. This component re-renders whenever the parent
      // DrawingCanvas re-renders on any store change (DrawingCanvas is not
      // wrapped in React.memo). Adding a subscription would be redundant and
      // would add render churn. If React.memo is ever added to DrawingCanvas,
      // this dependency MUST be re-evaluated. See F4 cascade gotcha documented
      // in DimensionElement.tsx lines 85-91 and next_session_resume.md.
      return null;
    default:
      return null;
  }
}
