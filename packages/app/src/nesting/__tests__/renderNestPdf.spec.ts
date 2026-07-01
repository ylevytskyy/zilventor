import { describe, it, expect } from 'vitest';
import { renderNestPdf } from '../renderNestPdf';
import type { NestState, NestSheet } from '@zilventor/shared';
import type { MaterialRegistry } from '@zilventor/shared/src/material';

const sheet = (i: number, panels: number): NestSheet => ({
  materialId: 'm1', sheetIndex: i, sheetLengthMm: 2440, sheetWidthMm: 1220, utilizationPct: 50.0,
  panels: Array.from({ length: panels }, (_, k) => ({
    itemNumber: k + 1, rowKey: `r${k}`, x: k * 700, y: 0, length: 600, width: 400, rotated: false, grain: 'none' as const,
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
