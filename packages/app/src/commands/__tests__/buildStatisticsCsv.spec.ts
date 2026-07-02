// @vitest-environment node
/**
 * buildStatisticsCsv — TDD spec (P4 W4, multi-section CSV export of StatisticsReport).
 * Mirrors buildCutListCsv's plainness: one section per category, blank-line
 * separators, subtotal row per section, grand total + unpriced-count note at end.
 */
import { describe, it, expect } from 'vitest';
import { buildStatisticsCsv } from '../buildStatisticsCsv';
import type { StatisticsReport } from '../buildStatisticsReport';

function makeReport(overrides: Partial<StatisticsReport> = {}): StatisticsReport {
  return {
    sections: [
      { category: 'hardware', lines: [], subtotal: 0 },
      { category: 'connectors', lines: [], subtotal: 0 },
      { category: 'edgeband', lines: [], subtotal: 0 },
      { category: 'linear', lines: [], subtotal: 0 },
      { category: 'panels', lines: [], subtotal: 0 },
    ],
    grandTotal: 0,
    unpricedLineCount: 0,
    ...overrides,
  };
}

describe('buildStatisticsCsv', () => {
  it('emits a header row for each of the five sections in order', () => {
    const csv = buildStatisticsCsv(makeReport());
    expect(csv).toContain('# Hardware');
    expect(csv).toContain('# Connectors');
    expect(csv).toContain('# Edge Band');
    expect(csv).toContain('# Linear Material');
    expect(csv).toContain('# Panels');
    const hwIdx = csv.indexOf('# Hardware');
    const connIdx = csv.indexOf('# Connectors');
    const ebIdx = csv.indexOf('# Edge Band');
    const linIdx = csv.indexOf('# Linear Material');
    const panIdx = csv.indexOf('# Panels');
    expect(hwIdx).toBeLessThan(connIdx);
    expect(connIdx).toBeLessThan(ebIdx);
    expect(ebIdx).toBeLessThan(linIdx);
    expect(linIdx).toBeLessThan(panIdx);
  });

  it('writes a data row with label, qty, unit, unit price, line total', () => {
    const report = makeReport({
      sections: [
        {
          category: 'hardware',
          lines: [{ key: 'hardware:h1', label: 'Hinge 110deg', qty: 4, unit: 'ea', unitPrice: 5.5, lineTotal: 22 }],
          subtotal: 22,
        },
        { category: 'connectors', lines: [], subtotal: 0 },
        { category: 'edgeband', lines: [], subtotal: 0 },
        { category: 'linear', lines: [], subtotal: 0 },
        { category: 'panels', lines: [], subtotal: 0 },
      ],
      grandTotal: 22,
    });
    const csv = buildStatisticsCsv(report);
    expect(csv).toContain('Hinge 110deg,4,ea,5.5,22');
  });

  it('leaves unit price / line total blank for unpriced lines', () => {
    const report = makeReport({
      sections: [
        { category: 'hardware', lines: [{ key: 'hardware:h2', label: 'Slide 500mm', qty: 2, unit: 'ea' }], subtotal: 0 },
        { category: 'connectors', lines: [], subtotal: 0 },
        { category: 'edgeband', lines: [], subtotal: 0 },
        { category: 'linear', lines: [], subtotal: 0 },
        { category: 'panels', lines: [], subtotal: 0 },
      ],
      unpricedLineCount: 1,
    });
    const csv = buildStatisticsCsv(report);
    expect(csv).toContain('Slide 500mm,2,ea,,');
  });

  it('emits a subtotal row per section', () => {
    const report = makeReport({
      sections: [
        {
          category: 'hardware',
          lines: [{ key: 'hardware:h1', label: 'Hinge', qty: 1, unit: 'ea', unitPrice: 5, lineTotal: 5 }],
          subtotal: 5,
        },
        { category: 'connectors', lines: [], subtotal: 0 },
        { category: 'edgeband', lines: [], subtotal: 0 },
        { category: 'linear', lines: [], subtotal: 0 },
        { category: 'panels', lines: [], subtotal: 0 },
      ],
      grandTotal: 5,
    });
    const csv = buildStatisticsCsv(report);
    expect(csv).toContain('Subtotal,,,,5');
  });

  it('emits one extra row per linear-material piece breakdown (R5.5)', () => {
    const report = makeReport({
      sections: [
        { category: 'hardware', lines: [], subtotal: 0 },
        { category: 'connectors', lines: [], subtotal: 0 },
        { category: 'edgeband', lines: [], subtotal: 0 },
        {
          category: 'linear',
          lines: [
            {
              key: 'linear:lm1',
              label: 'Aluminium rod',
              qty: 1890,
              unit: 'mm',
              unitPrice: 0.01,
              lineTotal: 18.9,
              pieces: [{ lengthMm: 958, qty: 1 }, { lengthMm: 466, qty: 2 }],
            },
          ],
          subtotal: 18.9,
        },
        { category: 'panels', lines: [], subtotal: 0 },
      ],
      grandTotal: 18.9,
    });
    const csv = buildStatisticsCsv(report);
    expect(csv).toContain('Aluminium rod,1890,mm,0.01,18.9');
    expect(csv).toContain('  1 x 958mm');
    expect(csv).toContain('  2 x 466mm');
  });

  it('emits grand total and unpriced-count note at the end', () => {
    const report = makeReport({ grandTotal: 123.45, unpricedLineCount: 3 });
    const csv = buildStatisticsCsv(report);
    expect(csv).toContain('Grand Total,,,,123.45');
    expect(csv).toContain('Unpriced lines,3');
  });
});
