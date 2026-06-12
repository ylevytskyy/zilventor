import { describe, it, expect } from 'vitest';
import { buildClashReport, VOLUME_THRESHOLD_MM3, CLEARANCE_DEFAULT_MM, isSameCabinetCarcassNoise, CARCASS_ROLES } from '../clash';
import type { ClashPair, ClashLeafMeta } from '../clash';

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

  // C1: filter predicate tests
  describe('isSameCabinetCarcassNoise', () => {
    /** Helper to build a minimal ClashLeafMeta with role and componentPath */
    function meta(path: string[], role?: string): ClashLeafMeta {
      return {
        componentPath: path,
        componentPathKey: path.join('/'),
        partName: path[path.length - 1] ?? 'part',
        ...(role !== undefined ? { role } : {}),
      };
    }

    it('CARCASS_ROLES contains the expected 7 structural roles', () => {
      expect(CARCASS_ROLES.has('leftSide')).toBe(true);
      expect(CARCASS_ROLES.has('rightSide')).toBe(true);
      expect(CARCASS_ROLES.has('top')).toBe(true);
      expect(CARCASS_ROLES.has('bottom')).toBe(true);
      expect(CARCASS_ROLES.has('back')).toBe(true);
      expect(CARCASS_ROLES.has('toekick')).toBe(true);
      expect(CARCASS_ROLES.has('shelf')).toBe(true);
      expect(CARCASS_ROLES.has('door')).toBe(false);
      expect(CARCASS_ROLES.has('drawerFront')).toBe(false);
    });

    it('same-cabinet carcass×carcass → SUPPRESSED', () => {
      const a = meta(['topAsm', 'cabinetA', 'leftSide'], 'leftSide');
      const b = meta(['topAsm', 'cabinetA', 'bottom'], 'bottom');
      expect(isSameCabinetCarcassNoise(a, b)).toBe(true);
    });

    it('same-cabinet carcass×shelf → SUPPRESSED', () => {
      const a = meta(['topAsm', 'cabinetA', 'top'], 'top');
      const b = meta(['topAsm', 'cabinetA', 'shelf1'], 'shelf');
      expect(isSameCabinetCarcassNoise(a, b)).toBe(true);
    });

    it('drawerFront×shelf in same cabinet → KEPT (not suppressed)', () => {
      const a = meta(['topAsm', 'cabinetA', 'df1'], 'drawerFront');
      const b = meta(['topAsm', 'cabinetA', 'shelf1'], 'shelf');
      expect(isSameCabinetCarcassNoise(a, b)).toBe(false);
    });

    it('cross-cabinet carcass×carcass → KEPT', () => {
      const a = meta(['topAsm', 'cabinetA', 'leftSide'], 'leftSide');
      const b = meta(['topAsm', 'cabinetB', 'rightSide'], 'rightSide');
      expect(isSameCabinetCarcassNoise(a, b)).toBe(false);
    });

    it('absent role on one side → KEPT', () => {
      const a = meta(['topAsm', 'cabinetA', 'custom'], undefined);
      const b = meta(['topAsm', 'cabinetA', 'bottom'], 'bottom');
      expect(isSameCabinetCarcassNoise(a, b)).toBe(false);
    });

    it('absent role on both sides → KEPT', () => {
      const a = meta(['topAsm', 'cabinetA', 'customA'], undefined);
      const b = meta(['topAsm', 'cabinetA', 'customB'], undefined);
      expect(isSameCabinetCarcassNoise(a, b)).toBe(false);
    });

    it('top-level leaf (path length < 2) → KEPT', () => {
      // path length 1 means no parent prefix — cannot establish "same cabinet"
      const a = meta(['leftSide'], 'leftSide');
      const b = meta(['topAsm', 'cabinetA', 'bottom'], 'bottom');
      expect(isSameCabinetCarcassNoise(a, b)).toBe(false);
    });

    it('both top-level (path length 1) → KEPT', () => {
      const a = meta(['leftSide'], 'leftSide');
      const b = meta(['bottom'], 'bottom');
      expect(isSameCabinetCarcassNoise(a, b)).toBe(false);
    });

    it('door×carcass in same cabinet → KEPT', () => {
      const a = meta(['topAsm', 'cabinetA', 'door1'], 'door');
      const b = meta(['topAsm', 'cabinetA', 'leftSide'], 'leftSide');
      expect(isSameCabinetCarcassNoise(a, b)).toBe(false);
    });
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
