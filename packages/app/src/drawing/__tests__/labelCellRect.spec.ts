import { describe, it, expect } from 'vitest';
import { labelCellRect, LABEL_LAYOUT } from '../renderLabelsPdf';

describe('labelCellRect', () => {
  const { marginMm, gutterMm, cols, rows, pageW, pageH } = LABEL_LAYOUT;
  const cellW = (pageW - 2 * marginMm - (cols - 1) * gutterMm) / cols; // 93
  const cellH = (pageH - 2 * marginMm - (rows - 1) * gutterMm) / rows; // 52.2

  it('places index 0 top-left of page 0', () => {
    expect(labelCellRect(0)).toEqual({ x: marginMm, y: marginMm, w: cellW, h: cellH, page: 0 });
  });

  it('places index 1 in the second column, same row', () => {
    const r = labelCellRect(1);
    expect(r.page).toBe(0);
    expect(r.x).toBeCloseTo(marginMm + cellW + gutterMm, 6);
    expect(r.y).toBeCloseTo(marginMm, 6);
  });

  it('places index 2 on the second row, first column', () => {
    const r = labelCellRect(2);
    expect(r.x).toBeCloseTo(marginMm, 6);
    expect(r.y).toBeCloseTo(marginMm + cellH + gutterMm, 6);
  });

  it('wraps index 10 to page 1, top-left', () => {
    const r = labelCellRect(10);
    expect(r.page).toBe(1);
    expect(r.x).toBeCloseTo(marginMm, 6);
    expect(r.y).toBeCloseTo(marginMm, 6);
  });

  it('places index 11 on page 1, second column', () => {
    const r = labelCellRect(11);
    expect(r.page).toBe(1);
    expect(r.x).toBeCloseTo(marginMm + cellW + gutterMm, 6);
  });
});
