import { describe, it, expect } from 'vitest';
import { renderLabelsPdf, drawLabelDiagram, type DiagramPdf } from '../renderLabelsPdf';
import { buildPanelLabels, type PanelLabel } from '../buildPanelLabels';
import { CYRILLIC_FONT_ID } from '../../vendor/pdfCyrillicFont';
import type { CutListResult, CutListRow } from '@zilventor/shared';

function row(over: Partial<CutListRow>): CutListRow {
  return {
    rowKey: 'k', itemNumber: 1, qty: 1, length: 600, width: 400, thickness: 18,
    materialId: 'mdf' as CutListRow['materialId'], materialName: 'MDF 18', grain: 'length',
    edgeBands: { front: null, back: null, left: null, right: null },
    partPath: 'p', partName: 'Side', componentPathKeys: ['c'], ...over,
  };
}

function panelLabel(over: Partial<PanelLabel>): PanelLabel {
  return {
    itemNumber: 1, partName: 'Side', materialName: 'MDF 18',
    length: 600, width: 400, thickness: 18, grain: 'length',
    edges: { front: false, back: false, left: false, right: false },
    copyIndex: 1, copyCount: 1, qrPayload: 'Z', rotated: false,
    ...over,
  };
}

/** Records `line()` calls; no-ops everything else on the DiagramPdf surface. */
function recordingPdf(): { pdf: DiagramPdf; lines: [number, number, number, number][] } {
  const lines: [number, number, number, number][] = [];
  const pdf: DiagramPdf = {
    setLineWidth: () => {},
    line: (x1, y1, x2, y2) => lines.push([x1, y1, x2, y2]),
    rect: () => {},
    setFontSize: () => {},
    text: () => {},
  };
  return { pdf, lines };
}

describe('renderLabelsPdf', () => {
  it('returns a non-empty PDF (%PDF header) for >10 labels', () => {
    const result: CutListResult = {
      rows: [row({ itemNumber: 1, qty: 12 })],
      bandTotals: [], excluded: { rows: [], reasons: [] } as unknown as CutListResult['excluded'],
    };
    const bytes = renderLabelsPdf(buildPanelLabels(result));
    expect(bytes.length).toBeGreaterThan(0);
    // "%PDF" magic = 0x25 0x50 0x44 0x46
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  it('renders exactly 2 pages for 12 labels (spec §7: perPage = cols*rows = 2*5 = 10)', () => {
    // 12 labels, 10 per page → 2 pages exactly.
    const result: CutListResult = {
      rows: [row({ itemNumber: 1, qty: 12 })],
      bandTotals: [], excluded: { rows: [], reasons: [] } as unknown as CutListResult['excluded'],
    };
    const bytes = renderLabelsPdf(buildPanelLabels(result));
    // Count individual page objects: jsPDF emits "/Type /Page" per page and
    // "/Type /Pages" (with trailing 's') for the parent Pages dict. The [^s]
    // guard excludes the parent so the count equals the actual page count.
    const text = new TextDecoder('latin1').decode(bytes);
    const pageCount = (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
    expect(pageCount).toBe(2);
  });

  it('produces a valid PDF for zero labels (single blank page, no throw)', () => {
    const bytes = renderLabelsPdf([]);
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  it('draws the grain arrow vertically for a length-grain panel nested rotated (effective grain = width)', () => {
    const { pdf, lines } = recordingPdf();
    const label = panelLabel({ grain: 'length', rotated: true });
    const box = { x: 0, y: 0, w: 100, h: 50 };

    drawLabelDiagram(pdf, label, box);

    const [x1, y1, x2, y2] = lines[0]!; // first (only, since no banded edges) line() call is the grain arrow
    expect(x1).toBe(x2); // vertical
    expect(y1).not.toBe(y2);
  });

  it('draws the grain arrow horizontally for a length-grain panel nested unrotated (effective grain = length)', () => {
    const { pdf, lines } = recordingPdf();
    const label = panelLabel({ grain: 'length', rotated: false });
    const box = { x: 0, y: 0, w: 100, h: 50 };

    drawLabelDiagram(pdf, label, box);

    const [x1, y1, x2, y2] = lines[0]!;
    expect(y1).toBe(y2); // horizontal
    expect(x1).not.toBe(x2);
  });

  it('renders Cyrillic materialName/partName via the embedded Cyrillic font (no throw, valid PDF, font referenced)', () => {
    const result: CutListResult = {
      rows: [row({
        itemNumber: 1, qty: 1,
        materialName: 'ДСП 18', partName: 'Бічна стінка',
      })],
      bandTotals: [], excluded: { rows: [], reasons: [] } as unknown as CutListResult['excluded'],
    };
    const bytes = renderLabelsPdf(buildPanelLabels(result));
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x25, 0x50, 0x44, 0x46]); // %PDF
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain(`/BaseFont /${CYRILLIC_FONT_ID}`);
  });
});
