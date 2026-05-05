// packages/app/src/drawing/AnnotationElement.tsx
import type { DrawingAnnotation, DrawingView } from '@zilventor/shared';

function edgeCenter(edgeId: string, view: DrawingView): { x: number; y: number } | null {
  const proj = view.projection;
  if (!proj) return null;
  const all = [...proj.visibleEdges, ...proj.hiddenEdges];
  const edge = all.find((e) => e.id === edgeId);
  if (!edge || edge.points.length === 0) return null;
  const s = view.scale.numerator / view.scale.denominator;
  const sum = edge.points.reduce((acc, p) => ({ x: acc.x + p[0], y: acc.y + p[1] }), { x: 0, y: 0 });
  return {
    x: view.positionMm.x + (sum.x / edge.points.length) * s,
    y: view.positionMm.y + (sum.y / edge.points.length) * s,
  };
}

const CROSS_SIZE = 4;   // mm — half-length of centerline/center-mark cross arms
const BALLOON_R = 5;    // mm — balloon circle radius

export type AnnotationElementProps = {
  ann: DrawingAnnotation;
  view: DrawingView;
};

export function AnnotationElement({ ann, view }: AnnotationElementProps) {
  switch (ann.kind) {
    case 'centerline': {
      const cA = edgeCenter(ann.edgeIdA, view);
      const cB = edgeCenter(ann.edgeIdB, view);
      if (!cA || !cB) return null;
      const mx = (cA.x + cB.x) / 2, my = (cA.y + cB.y) / 2;
      const dx = cB.x - cA.x, dy = cB.y - cA.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / len, uy = dy / len;
      const px = -uy, py = ux;
      return (
        <g data-ann-id={ann.id} data-ann-kind="centerline">
          <line x1={cA.x} y1={cA.y} x2={cB.x} y2={cB.y}
            stroke="#555" strokeWidth="0.18" strokeDasharray="4 2 1 2" />
          <line x1={mx - px * CROSS_SIZE} y1={my - py * CROSS_SIZE}
                x2={mx + px * CROSS_SIZE} y2={my + py * CROSS_SIZE}
            stroke="#555" strokeWidth="0.18" strokeDasharray="4 2 1 2" />
        </g>
      );
    }

    case 'center-mark': {
      const c = edgeCenter(ann.edgeId, view);
      if (!c) return null;
      return (
        <g data-ann-id={ann.id} data-ann-kind="center-mark">
          <line x1={c.x - CROSS_SIZE} y1={c.y} x2={c.x + CROSS_SIZE} y2={c.y}
            stroke="#555" strokeWidth="0.18" strokeDasharray="4 1" />
          <line x1={c.x} y1={c.y - CROSS_SIZE} x2={c.x} y2={c.y + CROSS_SIZE}
            stroke="#555" strokeWidth="0.18" strokeDasharray="4 1" />
          {/* Small solid cross at exact center */}
          <line x1={c.x - 1} y1={c.y} x2={c.x + 1} y2={c.y} stroke="#555" strokeWidth="0.35" />
          <line x1={c.x} y1={c.y - 1} x2={c.x} y2={c.y + 1} stroke="#555" strokeWidth="0.35" />
        </g>
      );
    }

    case 'leader': {
      const { targetMm: t, textPosMm: tp } = ann;
      return (
        <g data-ann-id={ann.id} data-ann-kind="leader">
          <polyline points={`${t.x},${t.y} ${tp.x},${tp.y}`}
            stroke="#222" strokeWidth="0.25" fill="none" />
          <text x={tp.x + 1} y={tp.y - 1} fontSize={3.5} fill="#111" data-ann-text>
            {ann.text}
          </text>
        </g>
      );
    }

    case 'balloon': {
      const { targetMm: t, textPosMm: tp, itemNumber } = ann;
      const cx = tp.x, cy = tp.y;
      return (
        <g data-ann-id={ann.id} data-ann-kind="balloon">
          {/* Leader from target to circle edge */}
          <polyline points={`${t.x},${t.y} ${cx - BALLOON_R},${cy}`}
            stroke="#222" strokeWidth="0.25" fill="none" />
          {/* Balloon circle */}
          <circle cx={cx} cy={cy} r={BALLOON_R} fill="white" stroke="#222" strokeWidth="0.35" />
          <text x={cx} y={cy + 1.5} textAnchor="middle" fontSize={4} fill="#111" data-ann-text>
            {String(itemNumber)}
          </text>
        </g>
      );
    }

    default:
      return null;
  }
}
