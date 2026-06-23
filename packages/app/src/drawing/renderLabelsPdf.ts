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
