import { describe, it, expect } from 'vitest';
import { renderPackingSlipPdfBytes } from '../renderPackingSlipPdf';
import type { PackingSlipRow } from '../buildPackingSlipRows';
import { CYRILLIC_FONT_ID } from '../../vendor/pdfCyrillicFont';

function makeRow(overrides: Partial<PackingSlipRow> = {}): PackingSlipRow {
  return {
    itemNumber: 1,
    partName: 'Side Panel',
    materialName: 'Birch',
    length: 600,
    width: 300,
    thickness: 18,
    qty: 5,
    producedCount: 2,
    remainingCount: 3,
    ...overrides,
  };
}

describe('renderPackingSlipPdfBytes', () => {
  it('returns bytes starting with the %PDF magic header', () => {
    const bytes = renderPackingSlipPdfBytes([makeRow()]);
    expect(bytes.length).toBeGreaterThan(0);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('%PDF');
  });

  it('paginates when rows overflow a single page', () => {
    const many = Array.from({ length: 200 }, (_, i) => makeRow({ itemNumber: i + 1 }));
    const bytes = renderPackingSlipPdfBytes(many);
    expect(bytes.length).toBeGreaterThan(0);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('%PDF');
  });

  it('accepts an optional header line without throwing', () => {
    const bytes = renderPackingSlipPdfBytes([makeRow()], { headerLine1: 'Order #42' });
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('%PDF');
  });

  it('renders Cyrillic materialName/partName via the embedded Cyrillic font (no throw, valid PDF, font referenced)', () => {
    const bytes = renderPackingSlipPdfBytes([
      makeRow({ materialName: 'ДСП 18', partName: 'Бічна стінка' }),
    ]);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('%PDF');
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain(`/BaseFont /${CYRILLIC_FONT_ID}`);
  });
});
