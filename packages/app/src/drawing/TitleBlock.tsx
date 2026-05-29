// packages/app/src/drawing/TitleBlock.tsx
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';
import type { PartDocument, AssemblyDocument } from '@zilventor/shared';
import { resolveTitleBlock } from '@zilventor/shared/src/drawing/titleBlock';

export type TitleBlockProps = {
  drawing: DrawingDocument;
  sheet: DrawingSheet;
  source: PartDocument | AssemblyDocument;
  sheetIndex: number;
  sheetCount: number;
  createdAt?: string;
};

// Inventor-2012-style title block at bottom-right of the sheet.
// All coordinates in mm (page-space). Sheet origin is top-left.
// For A3 landscape: sheet is 420 × 297 mm.
// Block is placed at (sheet_w - 190, sheet_h - 55) with w=185, h=50.

const TB_W = 185;    // block total width, mm
const TB_H = 50;     // block total height, mm
const COL1 = 90;     // left column width (label + value for main fields)
const ROW_H = 8;     // row height, mm
const FONT = 3.5;    // label font size, mm
const FONT_VAL = 4;  // value font size, mm
const LABEL_COLOR = '#555555';
const VALUE_COLOR = '#111111';
const STROKE_COLOR = '#222222';

function getSheetDimsMm(sheet: DrawingSheet): { w: number; h: number } {
  const ISO_MM: Record<string, { w: number; h: number }> = {
    A0: { w: 1189, h: 841 }, A1: { w: 841, h: 594 },
    A2: { w: 594, h: 420 },  A3: { w: 420, h: 297 },
    A4: { w: 297, h: 210 },
  };
  if (sheet.size.kind === 'custom') {
    const base = { w: sheet.size.widthMm, h: sheet.size.heightMm };
    return sheet.orientation === 'landscape' ? base : { w: base.h, h: base.w };
  }
  const base = ISO_MM[sheet.size.size] ?? { w: 420, h: 297 };
  return sheet.orientation === 'landscape' ? base : { w: base.h, h: base.w };
}

/**
 * ISO first-angle projection symbol glyph (React/SVG).
 * Geometry mirrors renderProjectionSymbolSvg() in renderDrawingSvg.ts — keep in sync.
 * First-angle: trapezoid narrow on LEFT, wide on RIGHT; circle to the RIGHT of trapezoid.
 * cx/cy = left anchor of the glyph (trapezoid left edge x-center).
 */
function ProjectionSymbol({ cx, cy }: { cx: number; cy: number }) {
  const r = 3;
  const trapW = 6;
  const halfHS = 2.5; // half-height at narrow (left) end
  const halfHT = 4;   // half-height at wide (right) end
  const tl = { x: cx,         y: cy - halfHS };
  const tr = { x: cx + trapW, y: cy - halfHT };
  const br = { x: cx + trapW, y: cy + halfHT };
  const bl = { x: cx,         y: cy + halfHS };
  const d = `M ${tl.x} ${tl.y} L ${tr.x} ${tr.y} L ${br.x} ${br.y} L ${bl.x} ${bl.y} Z`;
  const circleCx = cx + trapW + 1 + r;
  return (
    <g data-role="projection-symbol" data-projection="first-angle">
      <path d={d} fill="none" stroke="#000" strokeWidth={0.3} />
      <circle cx={circleCx} cy={cy} r={r} fill="none" stroke="#000" strokeWidth={0.3} />
    </g>
  );
}

export function TitleBlock({ drawing, sheet, source, sheetIndex, sheetCount, createdAt = '' }: TitleBlockProps) {
  const { w: sheetW, h: sheetH } = getSheetDimsMm(sheet);
  const ox = sheetW - TB_W - 5;
  const oy = sheetH - TB_H - 5;

  const fields = resolveTitleBlock(drawing, sheet, source, sheetIndex, sheetCount, createdAt);
  const sheetNofN = `${fields.sheetNumber.current} / ${fields.sheetNumber.total}`;

  // Row definitions: [label, value, x-offset in block, y-offset in block, width]
  const rows: Array<{ label: string; value: string; bx: number; by: number; bw: number }> = [
    { label: 'Drawing',   value: fields.drawingName, bx: 0,         by: 0,        bw: COL1 },
    { label: 'Part',      value: fields.partName,    bx: COL1,      by: 0,        bw: TB_W - COL1 },
    { label: 'Drawn By',  value: fields.drawnBy,     bx: 0,         by: ROW_H,    bw: COL1 },
    { label: 'Approved',  value: fields.approvedBy,  bx: COL1,      by: ROW_H,    bw: TB_W - COL1 },
    { label: 'Scale',     value: fields.scaleText,   bx: 0,         by: ROW_H*2,  bw: COL1 / 2 },
    { label: 'Date',      value: fields.date,        bx: COL1 / 2,  by: ROW_H*2,  bw: COL1 - COL1 / 2 },
    { label: 'Material',  value: fields.material,    bx: COL1,      by: ROW_H*2,  bw: TB_W - COL1 },
    { label: 'Revision',  value: fields.revision,    bx: 0,         by: ROW_H*3,  bw: COL1 },
    { label: 'Sheet',     value: sheetNofN,           bx: COL1,      by: ROW_H*3,  bw: TB_W - COL1 },
    { label: 'Notes',     value: fields.notes,        bx: 0,         by: ROW_H*4,  bw: TB_W },
  ];

  // Projection symbol: bottom-right corner of title block (~12×8mm glyph).
  // Mirrors renderTitleBlockSvg() placement in renderDrawingSvg.ts — keep in sync.
  // Place glyph left anchor ~18mm from block right edge, centered 8mm from bottom.
  const symCx = ox + TB_W - 18;
  const symCy = oy + TB_H - 8;

  return (
    <g data-title-block>
      {/* Outer border */}
      <rect x={ox} y={oy} width={TB_W} height={TB_H}
        fill="white" stroke={STROKE_COLOR} strokeWidth={0.5} />
      {/* Vertical separator */}
      <line x1={ox + COL1} y1={oy} x2={ox + COL1} y2={oy + TB_H}
        stroke={STROKE_COLOR} strokeWidth={0.25} />
      {/* Half-split of left col in row 2 */}
      <line x1={ox + COL1 / 2} y1={oy + ROW_H*2} x2={ox + COL1 / 2} y2={oy + ROW_H*3}
        stroke={STROKE_COLOR} strokeWidth={0.25} />

      {rows.map(({ label, value, bx, by, bw }, i) => {
        const rx = ox + bx;
        const ry = oy + by;
        return (
          <g key={i}>
            <rect x={rx} y={ry} width={bw} height={ROW_H}
              fill="none" stroke={STROKE_COLOR} strokeWidth={0.25} />
            <text x={rx + 1} y={ry + FONT + 0.5} fontSize={FONT} fill={LABEL_COLOR}>{label}</text>
            <text x={rx + 1} y={ry + ROW_H - 1.5} fontSize={FONT_VAL} fill={VALUE_COLOR}
              data-tb-field={label.toLowerCase().replace(/\s+/g, '-')}>
              {value}
            </text>
          </g>
        );
      })}

      {/* First-angle projection symbol in bottom-right corner */}
      <ProjectionSymbol cx={symCx} cy={symCy} />
    </g>
  );
}
