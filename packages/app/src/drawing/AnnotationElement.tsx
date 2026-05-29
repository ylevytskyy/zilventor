// packages/app/src/drawing/AnnotationElement.tsx
import type { DrawingAnnotation, DrawingView, PartsListAnnotation } from '@zilventor/shared';
import { HoleTableElement } from './HoleTableElement';

// ---------------------------------------------------------------------------
// Layout constants — must mirror renderPartsListAnnotation in renderDrawingSvg.ts
// ---------------------------------------------------------------------------
const PL_COL_ITEM_W  = 12;
const PL_COL_QTY_W   = 12;
const PL_COL_NAME_W  = 50;
const PL_COL_MAT_W   = 35;
const PL_COL_DIM_W   = 35;
const PL_COL_EDGE_W  = 25;
const PL_ROW_H       = 6;
const PL_FONT_SIZE   = 3.5;
const PL_GRID_COLOR  = '#222';
const PL_TABLE_W = PL_COL_ITEM_W + PL_COL_QTY_W + PL_COL_NAME_W + PL_COL_MAT_W + PL_COL_DIM_W + PL_COL_EDGE_W;

function PartsListElement({ ann }: { ann: PartsListAnnotation }) {
  const { x: tx, y: ty } = ann.positionMm;
  const rowCount = ann.rows.length + 1; // header + data
  const tableH   = rowCount * PL_ROW_H;

  const xItem = tx;
  const xQty  = tx + PL_COL_ITEM_W;
  const xName = tx + PL_COL_ITEM_W + PL_COL_QTY_W;
  const xMat  = tx + PL_COL_ITEM_W + PL_COL_QTY_W + PL_COL_NAME_W;
  const xDim  = tx + PL_COL_ITEM_W + PL_COL_QTY_W + PL_COL_NAME_W + PL_COL_MAT_W;
  const xEdge = tx + PL_COL_ITEM_W + PL_COL_QTY_W + PL_COL_NAME_W + PL_COL_MAT_W + PL_COL_DIM_W;

  const textY0 = ty + PL_ROW_H * 0.65;

  return (
    <g data-ann-id={ann.id} data-ann-kind="partsList">
      {/* Outer border */}
      <rect x={tx} y={ty} width={PL_TABLE_W} height={tableH}
        fill="white" stroke={PL_GRID_COLOR} strokeWidth="0.3" />
      {/* Header divider */}
      <line x1={tx} y1={ty + PL_ROW_H} x2={tx + PL_TABLE_W} y2={ty + PL_ROW_H}
        stroke={PL_GRID_COLOR} strokeWidth="0.3" />
      {/* Row dividers */}
      {ann.rows.slice(1).map((_, i) => (
        <line key={`rdiv-${i}`}
          x1={tx} y1={ty + PL_ROW_H * (i + 2)} x2={tx + PL_TABLE_W} y2={ty + PL_ROW_H * (i + 2)}
          stroke={PL_GRID_COLOR} strokeWidth="0.15" />
      ))}
      {/* Column dividers */}
      {[xQty, xName, xMat, xDim, xEdge].map((colX, i) => (
        <line key={`cdiv-${i}`}
          x1={colX} y1={ty} x2={colX} y2={ty + tableH}
          stroke={PL_GRID_COLOR} strokeWidth="0.2" />
      ))}
      {/* Header texts */}
      <text x={xItem + 1} y={textY0} fontSize={PL_FONT_SIZE} fill={PL_GRID_COLOR} fontWeight="bold">ITEM</text>
      <text x={xQty  + 1} y={textY0} fontSize={PL_FONT_SIZE} fill={PL_GRID_COLOR} fontWeight="bold">QTY</text>
      <text x={xName + 1} y={textY0} fontSize={PL_FONT_SIZE} fill={PL_GRID_COLOR} fontWeight="bold">PART NAME</text>
      <text x={xMat  + 1} y={textY0} fontSize={PL_FONT_SIZE} fill={PL_GRID_COLOR} fontWeight="bold">MATERIAL</text>
      <text x={xDim  + 1} y={textY0} fontSize={PL_FONT_SIZE} fill={PL_GRID_COLOR} fontWeight="bold">DIMENSIONS</text>
      <text x={xEdge + 1} y={textY0} fontSize={PL_FONT_SIZE} fill={PL_GRID_COLOR} fontWeight="bold">EDGE BANDS</text>
      {/* Data rows */}
      {ann.rows.map((row, i) => {
        const cellY = ty + PL_ROW_H * (i + 1) + PL_ROW_H * 0.65;
        return (
          <g key={`row-${i}`}>
            <text x={xItem + 1} y={cellY} fontSize={PL_FONT_SIZE} fill={PL_GRID_COLOR}>{String(row.item)}</text>
            <text x={xQty  + 1} y={cellY} fontSize={PL_FONT_SIZE} fill={PL_GRID_COLOR}>{String(row.qty)}</text>
            <text x={xName + 1} y={cellY} fontSize={PL_FONT_SIZE} fill={PL_GRID_COLOR}>{row.partName}</text>
            <text x={xMat  + 1} y={cellY} fontSize={PL_FONT_SIZE} fill={PL_GRID_COLOR}>{row.material}</text>
            <text x={xDim  + 1} y={cellY} fontSize={PL_FONT_SIZE} fill={PL_GRID_COLOR}>{row.dimensions}</text>
            <text x={xEdge + 1} y={cellY} fontSize={PL_FONT_SIZE} fill={PL_GRID_COLOR}>{row.edgeBands}</text>
          </g>
        );
      })}
    </g>
  );
}

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
  view: DrawingView | undefined;
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

    case 'holeTable':
      return <HoleTableElement ann={ann} view={view!} />;

    case 'partsList':
      return <PartsListElement ann={ann} />;

    default:
      return null;
  }
}
