// packages/app/src/drawing/HoleTableElement.tsx
//
// STRUCTURAL DEPENDENCY (F4 cascade pattern):
//   NO useStore subscription on activePart. This component re-renders whenever
//   the parent DrawingCanvas re-renders on any store change, so a subscription
//   would be redundant and add render churn. Uses getState() snapshot instead.
//   IMPORTANT: Any future React.memo on DrawingCanvas WILL silently break the
//   live cascade for hole-table rows, because this component would stop
//   re-rendering on part changes. See DimensionElement.tsx lines 87-97 for the
//   same pattern.

import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { computeHoleTableRows } from '@zilventor/shared/src/drawing/holeTable';
import type { HoleTableAnnotation, DrawingView } from '@zilventor/shared';
import type { ParamOrLiteral } from '@zilventor/shared';

// Layout constants (sheet-mm)
const COL_TAG_W   = 12;
const COL_X_W     = 18;
const COL_Y_W     = 18;
const COL_DESC_W  = 45;
const ROW_H       = 6;
const BALLOON_R   = 3;
const FONT_SIZE   = 3.5;
const LEADER_COLOR = '#333';
const GRID_COLOR   = '#222';

const TABLE_W = COL_TAG_W + COL_X_W + COL_Y_W + COL_DESC_W;

export type HoleTableElementProps = {
  ann: HoleTableAnnotation;
  view: DrawingView;
};

export function HoleTableElement({ ann, view }: HoleTableElementProps) {
  // Non-reactive snapshot read — see STRUCTURAL DEPENDENCY note above.
  const activePart = useAppStore.getState().activePart;

  if (!activePart) return null;

  const resolveParam = (p: ParamOrLiteral): number =>
    p.kind === 'literal'
      ? p.value
      : (activePart.parameters[p.paramName]?.value ?? 0);

  const rows = computeHoleTableRows(ann, view, activePart, resolveParam);
  if (rows.length === 0) return null;

  const { x: tx, y: ty } = ann.positionMm;

  // Column x offsets
  const xTag  = tx;
  const xX    = tx + COL_TAG_W;
  const xY    = tx + COL_TAG_W + COL_X_W;
  const xDesc = tx + COL_TAG_W + COL_X_W + COL_Y_W;

  // Grid lines — outer border + internal column lines + row lines
  const rowCount = rows.length + 1; // +1 for header
  const tableH   = rowCount * ROW_H;

  const gridLines: React.ReactNode[] = [];

  // Outer border
  gridLines.push(
    <rect key="border"
      x={tx} y={ty} width={TABLE_W} height={tableH}
      fill="white" stroke={GRID_COLOR} strokeWidth="0.3" />,
  );

  // Header divider
  gridLines.push(
    <line key="hdr-div"
      x1={tx} y1={ty + ROW_H} x2={tx + TABLE_W} y2={ty + ROW_H}
      stroke={GRID_COLOR} strokeWidth="0.3" />,
  );

  // Internal row dividers
  rows.forEach((_, i) => {
    if (i > 0) {
      gridLines.push(
        <line key={`row-div-${i}`}
          x1={tx} y1={ty + ROW_H * (i + 1)} x2={tx + TABLE_W} y2={ty + ROW_H * (i + 1)}
          stroke={GRID_COLOR} strokeWidth="0.15" />,
      );
    }
  });

  // Column dividers
  [xX, xY, xDesc].forEach((colX, i) => {
    gridLines.push(
      <line key={`col-div-${i}`}
        x1={colX} y1={ty} x2={colX} y2={ty + tableH}
        stroke={GRID_COLOR} strokeWidth="0.2" />,
    );
  });

  // Header texts
  const textY0 = ty + ROW_H * 0.65; // vertically centred in header row
  const headerTexts = (
    <g data-role="hole-table-header">
      <text x={xTag  + 1}  y={textY0} fontSize={FONT_SIZE} fill={GRID_COLOR} fontWeight="bold">TAG</text>
      <text x={xX    + 1}  y={textY0} fontSize={FONT_SIZE} fill={GRID_COLOR} fontWeight="bold">XDIM</text>
      <text x={xY    + 1}  y={textY0} fontSize={FONT_SIZE} fill={GRID_COLOR} fontWeight="bold">YDIM</text>
      <text x={xDesc + 1}  y={textY0} fontSize={FONT_SIZE} fill={GRID_COLOR} fontWeight="bold">DESCRIPTION</text>
    </g>
  );

  // Data rows
  const dataRows = rows.map((row, i) => {
    const rowY = ty + ROW_H * (i + 1);
    const cellY = rowY + ROW_H * 0.65;
    return (
      <g key={row.tag} data-role="hole-table-row" data-tag={row.tag}
         data-holetable-row={row.tag}>
        <text x={xTag  + 1} y={cellY} fontSize={FONT_SIZE} fill={GRID_COLOR}
              data-holetable-tag={row.tag}>{row.tag}</text>
        <text x={xX    + 1} y={cellY} fontSize={FONT_SIZE} fill={GRID_COLOR}
              data-holetable-xdim={row.tag}>
          {(Math.round(row.xDim * 10) / 10).toFixed(1)}
        </text>
        <text x={xY    + 1} y={cellY} fontSize={FONT_SIZE} fill={GRID_COLOR}
              data-holetable-ydim={row.tag}>
          {(Math.round(row.yDim * 10) / 10).toFixed(1)}
        </text>
        <text x={xDesc + 1} y={cellY} fontSize={FONT_SIZE} fill={GRID_COLOR}>{row.description}</text>
      </g>
    );
  });

  // Per-hole balloons + leaders
  // Balloon is placed 8mm above markerCenterSheetMm so it clears the hole outline.
  const BALLOON_OFFSET_Y = -8;
  const balloonElements = rows.map((row) => {
    const bx = row.markerCenterSheetMm.x;
    const by = row.markerCenterSheetMm.y + BALLOON_OFFSET_Y;
    return (
      <g key={`balloon-${row.tag}`} data-holetable-marker={row.tag}>
        {/* Leader from balloon circle edge to hole center */}
        <line
          data-role="hole-leader"
          x1={bx} y1={by + BALLOON_R}
          x2={row.markerCenterSheetMm.x} y2={row.markerCenterSheetMm.y}
          stroke={LEADER_COLOR} strokeWidth="0.25"
        />
        {/* Balloon circle */}
        <circle
          data-role="hole-balloon"
          cx={bx} cy={by} r={BALLOON_R}
          fill="white" stroke={LEADER_COLOR} strokeWidth="0.3"
        />
        <text x={bx} y={by + 1.2} textAnchor="middle" fontSize={FONT_SIZE - 0.5} fill={LEADER_COLOR}>
          {row.tag}
        </text>
      </g>
    );
  });

  return (
    <g data-ann-id={ann.id} data-ann-kind="holeTable">
      {gridLines}
      {headerTexts}
      {dataRows}
      {balloonElements}
    </g>
  );
}
