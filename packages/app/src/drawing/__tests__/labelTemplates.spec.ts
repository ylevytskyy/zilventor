import { describe, it, expect } from 'vitest';
import {
  drawRichLabelCell,
  drawCompactLabelCell,
  drawPageHeader,
  renderLabelsPdf,
  LABEL_LAYOUT,
  labelCellRect,
} from '../renderLabelsPdf';
import type { PanelLabel } from '../buildPanelLabels';

function stubCellPdf() {
  const rects: Array<[number, number, number, number, string | undefined]> = [];
  const texts: Array<[string, number, number]> = [];
  return {
    pdf: {
      setDrawColor: () => {},
      setLineWidth: () => {},
      line: () => {},
      rect: (x: number, y: number, w: number, h: number, style?: string) =>
        rects.push([x, y, w, h, style]),
      setFontSize: () => {},
      text: (t: string, x: number, y: number) => texts.push([t, x, y]),
      setFillColor: () => {},
    },
    rects,
    texts,
  };
}

const label: PanelLabel = {
  itemNumber: 1,
  partName: 'Side',
  materialName: 'MDF',
  length: 600,
  width: 400,
  thickness: 18,
  grain: 'length',
  edges: { front: true, back: false, left: false, right: false },
  copyIndex: 1,
  copyCount: 1,
  qrPayload: 'Z|1|1/1|600x400x18|MDF',
  rotated: false,
};

const cell = labelCellRect(0, LABEL_LAYOUT);

describe('drawRichLabelCell', () => {
  it('draws the mini diagram outline in addition to the cell border', () => {
    const s = stubCellPdf();
    drawRichLabelCell(s.pdf, label, cell);
    const unstyled = s.rects.filter((r) => r[4] === undefined);
    // Cell border + diagram panel outline = 2 unstyled rects.
    expect(unstyled.length).toBe(2);
  });
});

describe('drawCompactLabelCell', () => {
  it('omits the mini diagram outline (only the cell border remains unstyled)', () => {
    const s = stubCellPdf();
    drawCompactLabelCell(s.pdf, label, cell);
    const unstyled = s.rects.filter((r) => r[4] === undefined);
    expect(unstyled.length).toBe(1);
  });

  it('draws a strictly larger QR than the rich template for the same cell/label', () => {
    const rich = stubCellPdf();
    drawRichLabelCell(rich.pdf, label, cell);
    const compact = stubCellPdf();
    drawCompactLabelCell(compact.pdf, label, cell);

    const richModuleW = rich.rects.find((r) => r[4] === 'F')![2];
    const compactModuleW = compact.rects.find((r) => r[4] === 'F')![2];
    expect(compactModuleW).toBeGreaterThan(richModuleW);
  });

  it('still draws the text block (item number present in some text call)', () => {
    const s = stubCellPdf();
    drawCompactLabelCell(s.pdf, label, cell);
    expect(s.texts.some((t) => t[0].includes('#1'))).toBe(true);
  });
});

describe('drawPageHeader', () => {
  function stubHeaderPdf() {
    const texts: Array<[string, number, number]> = [];
    return {
      pdf: {
        setFontSize: () => {},
        text: (t: string, x: number, y: number) => texts.push([t, x, y]),
      },
      texts,
    };
  }

  it('does nothing when both lines are empty', () => {
    const s = stubHeaderPdf();
    drawPageHeader(s.pdf, '', '');
    expect(s.texts.length).toBe(0);
  });

  it('draws both lines (reserving the blank slot) when only one is non-empty', () => {
    const s = stubHeaderPdf();
    drawPageHeader(s.pdf, '', 'Batch 2');
    expect(s.texts.length).toBe(2);
    expect(s.texts[0]?.[0]).toBe('');
    expect(s.texts[1]?.[0]).toBe('Batch 2');
  });

  it('draws both lines with their content when both are non-empty', () => {
    const s = stubHeaderPdf();
    drawPageHeader(s.pdf, 'Order #42', 'Kitchen');
    expect(s.texts.map((t) => t[0])).toEqual(['Order #42', 'Kitchen']);
  });
});

describe('renderLabelsPdf — templateId + header options', () => {
  it('produces a valid PDF with templateId "compact" and a header', () => {
    const bytes = renderLabelsPdf([label], { templateId: 'compact', headerLine1: 'Order #42' });
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x25, 0x50, 0x44, 0x46]);
  });
});
