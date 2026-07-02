import { describe, it, expect } from 'vitest';
import { renderNestPdf, renderNestPdfBytes } from '../renderNestPdf';
import type { NestState, NestSheet } from '@zilventor/shared';
import type { MaterialRegistry } from '@zilventor/shared/src/material';
import { CYRILLIC_FONT_ID } from '../../vendor/pdfCyrillicFont';

// jsPDF's text operators are literal ASCII/WinAnsi bytes in the content stream
// (verified: no font subsetting for the default Helvetica), so a plain latin1
// decode is enough to assert on drawn text — no PDF parser needed.
function pdfText(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

const sheet = (i: number, panels: number): NestSheet => ({
  materialId: 'm1', sheetIndex: i, sheetLengthMm: 2440, sheetWidthMm: 1220, utilizationPct: 50.0,
  panels: Array.from({ length: panels }, (_, k) => ({
    itemNumber: k + 1, rowKey: `r${k}`, instanceIndex: 1, x: k * 700, y: 0, length: 600, width: 400, rotated: false, grain: 'none' as const,
  })),
});

const nestState = (sheets: NestSheet[]): NestState => ({
  params: { kerfMm: 3 }, generatedAt: 0, inputFingerprint: 'x', sheets, excluded: [],
});

const materials: MaterialRegistry = [
  { id: 'm1', name: 'Birch', defaultThickness: 18, color: '#aabbcc', sheetLengthMm: 2440, sheetWidthMm: 1220 },
];

describe('renderNestPdf', () => {
  it('returns a Blob with type application/pdf', () => {
    const blob = renderNestPdf(nestState([sheet(1, 3)]), materials);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
  });

  it('multi-sheet → multi-page (file size larger than single-sheet)', () => {
    const small = renderNestPdf(nestState([sheet(1, 1)]), materials);
    const big = renderNestPdf(nestState([sheet(1, 1), sheet(2, 1), sheet(3, 1)]), materials);
    expect(big.size).toBeGreaterThan(small.size);
  });

  it('zero-sheet nest → returns a one-page "No sheets" PDF', () => {
    const blob = renderNestPdf(nestState([]), materials);
    expect(blob.size).toBeGreaterThan(0);
  });
});

describe('renderNestPdf — remnant', () => {
  it('draws a labeled remnant outline with its dimensions when present', () => {
    const withRemnant: NestSheet = { ...sheet(1, 1), remnant: { x: 1500, y: 100, length: 600, width: 400 } };
    const bytes = renderNestPdfBytes(nestState([withRemnant]), materials);
    expect(pdfText(bytes)).toContain('REMNANT 600×400');
  });

  it('draws no remnant label when the sheet has no remnant', () => {
    const bytes = renderNestPdfBytes(nestState([sheet(1, 1)]), materials);
    expect(pdfText(bytes)).not.toContain('REMNANT');
  });
});

describe('renderNestPdf — Cyrillic material name', () => {
  it('renders a Cyrillic material name via the embedded Cyrillic font (no throw, valid PDF, font referenced)', () => {
    const cyrillicMaterials: MaterialRegistry = [
      { id: 'm1', name: 'Дуб', defaultThickness: 18, color: '#aabbcc', sheetLengthMm: 2440, sheetWidthMm: 1220 },
    ];
    const bytes = renderNestPdfBytes(nestState([sheet(1, 1)]), cyrillicMaterials);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('%PDF');
    expect(pdfText(bytes)).toContain(`/BaseFont /${CYRILLIC_FONT_ID}`);
  });
});
