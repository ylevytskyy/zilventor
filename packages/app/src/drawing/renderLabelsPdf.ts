import { jsPDF } from 'jspdf';
import type { PanelEdgeKey, GrainDirection } from '@zilventor/shared';
import type { PanelLabel } from './buildPanelLabels';
import { drawQr, qrMatrix } from './qr';

export const LABEL_LAYOUT = {
  cols: 2,
  rows: 5,
  marginMm: 10,
  gutterMm: 4,
  pageW: 210, // A4 portrait
  pageH: 297,
} as const;

export type LabelLayout = typeof LABEL_LAYOUT;

export interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
  page: number; // 0-based
}

/** index → label-cell geometry (mm) and 0-based page. Pure pagination math. */
export function labelCellRect(index: number, layout: LabelLayout = LABEL_LAYOUT): CellRect {
  const { cols, rows, marginMm, gutterMm, pageW, pageH } = layout;
  const perPage = cols * rows;
  const cellW = (pageW - 2 * marginMm - (cols - 1) * gutterMm) / cols;
  const cellH = (pageH - 2 * marginMm - (rows - 1) * gutterMm) / rows;
  const page = Math.floor(index / perPage);
  const within = index % perPage;
  const row = Math.floor(within / cols);
  const col = within % cols;
  return {
    x: marginMm + col * (cellW + gutterMm),
    y: marginMm + row * (cellH + gutterMm),
    w: cellW,
    h: cellH,
    page,
  };
}

// ─── Diagram geometry helpers ────────────────────────────────────────────────

export type DiagramSide = 'top' | 'bottom' | 'left' | 'right';

/**
 * LOAD-BEARING. Verified against renderPanelManufacturingDxf.ts:99-103 (EDGE_LINE) and
 * cutListRow.ts grossLength/grossWidth comments: panel drawn length-horizontal (X),
 * width-vertical (Y). DO NOT change without re-grounding in panel geometry.
 */
export const EDGE_SIDE: Record<PanelEdgeKey, DiagramSide> = {
  front: 'top',
  back: 'bottom',
  left: 'left',
  right: 'right',
};

export const EDGE_LETTER: Record<PanelEdgeKey, string> = {
  front: 'F',
  back: 'B',
  left: 'L',
  right: 'R',
};

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** [x1,y1,x2,y2] for the given side of box b (PDF coords, y grows downward → top = min y). */
export function sideSegment(side: DiagramSide, b: Box): [number, number, number, number] {
  switch (side) {
    case 'top':
      return [b.x, b.y, b.x + b.w, b.y];
    case 'bottom':
      return [b.x, b.y + b.h, b.x + b.w, b.y + b.h];
    case 'left':
      return [b.x, b.y, b.x, b.y + b.h];
    case 'right':
      return [b.x + b.w, b.y, b.x + b.w, b.y + b.h];
  }
}

/** Centered grain arrow segment, or null for grain 'none'. length→horizontal, width→vertical. */
export function grainArrow(grain: GrainDirection, b: Box): [number, number, number, number] | null {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  if (grain === 'length') return [b.x + b.w * 0.2, cy, b.x + b.w * 0.8, cy];
  if (grain === 'width') return [cx, b.y + b.h * 0.2, cx, b.y + b.h * 0.8];
  return null;
}

export interface DiagramPdf {
  setLineWidth(w: number): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  rect(x: number, y: number, w: number, h: number, style?: string): void;
  setFontSize(s: number): void;
  text(t: string, x: number, y: number): void;
}

const DIAGRAM_EDGE_KEYS: PanelEdgeKey[] = ['front', 'back', 'left', 'right'];

/** Draw the mini panel diagram (panel box scaled to length:width, grain arrow, banded edges). */
export function drawLabelDiagram(pdf: DiagramPdf, label: PanelLabel, rect: Box): void {
  // Fit a length:width box inside rect, preserving aspect, with a small inset.
  const inset = 1.5;
  const availW = rect.w - 2 * inset;
  const availH = rect.h - 2 * inset;
  const scale = Math.min(availW / label.length, availH / label.width);
  const pw = label.length * scale;
  const ph = label.width * scale;
  const box: Box = {
    x: rect.x + (rect.w - pw) / 2,
    y: rect.y + (rect.h - ph) / 2,
    w: pw,
    h: ph,
  };

  // Panel outline (thin).
  pdf.setLineWidth(0.2);
  pdf.rect(box.x, box.y, box.w, box.h);

  // Grain arrow — reflects this copy's as-nested rotation (same swap as renderNestSheetDxf's drawGrain).
  const effectiveGrain: GrainDirection = !label.rotated || label.grain === 'none'
    ? label.grain
    : label.grain === 'length' ? 'width' : 'length';
  const arrow = grainArrow(effectiveGrain, box);
  if (arrow) {
    pdf.setLineWidth(0.3);
    pdf.line(arrow[0], arrow[1], arrow[2], arrow[3]);
  }

  // Banded edges (thick) + letter.
  pdf.setLineWidth(0.9);
  pdf.setFontSize(5);
  for (const key of DIAGRAM_EDGE_KEYS) {
    if (!label.edges[key]) continue;
    const side = EDGE_SIDE[key];
    const seg = sideSegment(side, box);
    pdf.line(seg[0], seg[1], seg[2], seg[3]);
    // Letter just inside the midpoint of the segment.
    const mx = (seg[0] + seg[2]) / 2;
    const my = (seg[1] + seg[3]) / 2;
    pdf.text(EDGE_LETTER[key], mx, my);
  }
}

/** Minimal jspdf surface a label-cell template needs — keeps templates pure & stub-testable. */
export interface LabelCellPdf {
  setDrawColor(r: number, g: number, b: number): void;
  setLineWidth(w: number): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  rect(x: number, y: number, w: number, h: number, style?: string): void;
  setFontSize(s: number): void;
  text(t: string, x: number, y: number): void;
  setFillColor(r: number, g: number, b: number): void;
}

/** Draw one label into its cell: border, text block, mini diagram, QR. Today's unchanged layout. */
export function drawRichLabelCell(pdf: LabelCellPdf, label: PanelLabel, cell: CellRect): void {
  const pad = 3;
  // Cell border.
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.2);
  pdf.rect(cell.x, cell.y, cell.w, cell.h);

  // Text block (top-left).
  const tx = cell.x + pad;
  let ty = cell.y + pad + 3;
  pdf.setFontSize(9);
  pdf.text(`#${label.itemNumber}  ${label.partName}`, tx, ty);
  ty += 5;
  pdf.setFontSize(7);
  pdf.text(label.materialName, tx, ty);
  ty += 4;
  pdf.text(`${label.length} x ${label.width} x ${label.thickness} mm`, tx, ty);
  ty += 4;
  pdf.text(`copy ${label.copyIndex}/${label.copyCount}`, tx, ty);

  // QR (top-right corner).
  const qrSize = Math.min(cell.h - 2 * pad, cell.w * 0.3);
  drawQr(pdf, qrMatrix(label.qrPayload), cell.x + cell.w - pad - qrSize, cell.y + pad, qrSize);

  // Mini panel diagram (bottom band of the cell).
  const diagTop = ty + 2;
  drawLabelDiagram(pdf, label, {
    x: tx,
    y: diagTop,
    w: cell.w - 2 * pad,
    h: cell.y + cell.h - pad - diagTop,
  });
}

/** QR-forward template: no mini diagram, larger QR code, same text block. */
export function drawCompactLabelCell(pdf: LabelCellPdf, label: PanelLabel, cell: CellRect): void {
  const pad = 3;
  // Cell border.
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.2);
  pdf.rect(cell.x, cell.y, cell.w, cell.h);

  // Text block (top-left) — same content as the rich template.
  const tx = cell.x + pad;
  let ty = cell.y + pad + 3;
  pdf.setFontSize(9);
  pdf.text(`#${label.itemNumber}  ${label.partName}`, tx, ty);
  ty += 5;
  pdf.setFontSize(7);
  pdf.text(label.materialName, tx, ty);
  ty += 4;
  pdf.text(`${label.length} x ${label.width} x ${label.thickness} mm`, tx, ty);
  ty += 4;
  pdf.text(`copy ${label.copyIndex}/${label.copyCount}`, tx, ty);

  // QR (top-right corner) — enlarged to use the space freed by dropping the diagram.
  const qrSize = cell.h - 2 * pad;
  drawQr(pdf, qrMatrix(label.qrPayload), cell.x + cell.w - pad - qrSize, cell.y + pad, qrSize);
}

/** Minimal jspdf surface drawPageHeader needs — keeps it pure & stub-testable. */
export interface HeaderPdf {
  setFontSize(s: number): void;
  text(t: string, x: number, y: number): void;
}

/**
 * Draw a 2-line header band inside the existing top margin of the current page.
 * No-op when both lines are empty; otherwise draws both (an empty line still
 * reserves its slot at a fixed y-position).
 */
export function drawPageHeader(pdf: HeaderPdf, line1: string, line2: string): void {
  if (!line1 && !line2) return;
  pdf.setFontSize(8);
  pdf.text(line1, LABEL_LAYOUT.marginMm, 5);
  pdf.text(line2, LABEL_LAYOUT.marginMm, 8.5);
}

export type LabelTemplateId = 'rich' | 'compact';

export interface RenderLabelsPdfOptions {
  layout?: LabelLayout;
  templateId?: LabelTemplateId;
  headerLine1?: string;
  headerLine2?: string;
}

/** Render all labels onto an A4 portrait PDF; returns the file bytes. */
export function renderLabelsPdf(labels: PanelLabel[], opts: RenderLabelsPdfOptions = {}): Uint8Array {
  const { layout = LABEL_LAYOUT, templateId = 'rich', headerLine1 = '', headerLine2 = '' } = opts;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const perPage = layout.cols * layout.rows;
  const drawCell = templateId === 'compact' ? drawCompactLabelCell : drawRichLabelCell;
  drawPageHeader(pdf, headerLine1, headerLine2);
  labels.forEach((label, i) => {
    if (i > 0 && i % perPage === 0) {
      pdf.addPage();
      drawPageHeader(pdf, headerLine1, headerLine2);
    }
    drawCell(pdf, label, labelCellRect(i, layout));
  });
  return new Uint8Array(pdf.output('arraybuffer'));
}
