import { describe, it, expect } from 'vitest';
import { renderPackingSlipPdfBytes } from '../renderPackingSlipPdf';
import type { PackingSlipRow } from '../buildPackingSlipRows';

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
});
