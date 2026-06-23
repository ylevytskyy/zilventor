import type { PanelEdgeKey, GrainDirection } from '@zilventor/shared';
import type { PanelLabel } from './buildPanelLabels';

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

  // Grain arrow.
  const arrow = grainArrow(label.grain, box);
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
