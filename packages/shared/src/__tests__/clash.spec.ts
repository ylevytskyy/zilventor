import { describe, it, expect } from 'vitest';
import { buildClashReport, VOLUME_THRESHOLD_MM3, CLEARANCE_DEFAULT_MM } from '../clash';
import type { ClashPair } from '../clash';

describe('buildClashReport', () => {
  const leafMeta = [
    { componentPath: ['A'], componentPathKey: 'A', partName: 'Panel A' },
    { componentPath: ['B'], componentPathKey: 'B', partName: 'Panel B' },
    { componentPath: ['nested', 'C'], componentPathKey: 'nested C', partName: 'Panel C' },
  ];

  it('maps interference pair to ClashReportRow with volume', () => {
    const pairs: ClashPair[] = [
      { aIndex: 0, bIndex: 1, kind: 'interference', volume: 1800 },
    ];
    const rows = buildClashReport(pairs, leafMeta);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.kind).toBe('interference');
    expect(row.aName).toBe('Panel A');
    expect(row.bName).toBe('Panel B');
    expect(row.aPathKey).toBe('A');
    expect(row.bPathKey).toBe('B');
    expect(row.aPath).toEqual(['A']);
    expect(row.bPath).toEqual(['B']);
    expect(row.volume).toBeCloseTo(1800);
    expect(row.distance).toBeUndefined();
  });

  it('maps clearance pair to ClashReportRow with distance', () => {
    const pairs: ClashPair[] = [
      { aIndex: 0, bIndex: 2, kind: 'clearance', distance: 0.5 },
    ];
    const rows = buildClashReport(pairs, leafMeta);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.kind).toBe('clearance');
    expect(row.aPathKey).toBe('A');
    expect(row.bPathKey).toBe('nested C');
    expect(row.aPath).toEqual(['A']);
    expect(row.bPath).toEqual(['nested', 'C']);
    expect(row.distance).toBeCloseTo(0.5);
    expect(row.volume).toBeUndefined();
  });

  it('empty pairs → empty rows', () => {
    expect(buildClashReport([], leafMeta)).toHaveLength(0);
  });

  it('VOLUME_THRESHOLD_MM3 is a positive number', () => {
    expect(VOLUME_THRESHOLD_MM3).toBeGreaterThan(0);
  });

  it('CLEARANCE_DEFAULT_MM is 1.0', () => {
    expect(CLEARANCE_DEFAULT_MM).toBe(1.0);
  });

  // SC-13(a): precedence — if a pair is interference it must not also appear as clearance
  it('SC-13(a): two rows for two distinct pairs', () => {
    const pairs: ClashPair[] = [
      { aIndex: 0, bIndex: 1, kind: 'interference', volume: 500 },
      { aIndex: 0, bIndex: 2, kind: 'clearance', distance: 0.8 },
    ];
    const rows = buildClashReport(pairs, leafMeta);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.kind).toBe('interference');
    expect(rows[1]!.kind).toBe('clearance');
  });
});
