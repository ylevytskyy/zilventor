import { describe, it, expect } from 'vitest';
import type { ProjectFile } from '../types';

describe('ProjectFile union — drawing arm (v14)', () => {
  it('a synthetic v14 drawing ProjectFile type-checks at compile time', () => {
    // This test exercises the type at runtime via a cast + property access.
    const manifest = {
      formatVersion: 14 as const,
      kind: 'drawing' as const,
      createdAt: '2026-05-05T00:00:00.000Z',
      appVersion: '0.6.0',
      document: {
        id: 'draw-1',
        name: 'Cabinet — Drawing',
        units: 'mm' as const,
        source: { partPath: 'parts/cabinet1.zipt', sourceKind: 'part' as const },
        properties: {},
        sheets: [],
        activeSheetId: '',
      },
    } satisfies ProjectFile;

    expect(manifest.kind).toBe('drawing');
    expect(manifest.formatVersion).toBe(14);
    expect(manifest.document.units).toBe('mm');
  });

  it('a v14 part ProjectFile type-checks (existing arm extended)', () => {
    const manifest = {
      formatVersion: 14 as const,
      kind: 'part' as const,
      createdAt: '2026-05-05T00:00:00.000Z',
      appVersion: '0.6.0',
      document: {
        id: 'p1',
        name: 'Cabinet',
        units: 'mm' as const,
        parameters: {},
        featureTree: [],
        properties: {},
        materials: [],
        hardware: [],
      },
    } satisfies ProjectFile;

    expect(manifest.kind).toBe('part');
    expect(manifest.formatVersion).toBe(14);
  });

  it('a v14 assembly ProjectFile type-checks (existing arm extended)', () => {
    const manifest = {
      formatVersion: 14 as const,
      kind: 'assembly' as const,
      createdAt: '2026-05-05T00:00:00.000Z',
      appVersion: '0.6.0',
      document: {
        id: 'a1',
        name: 'Wardrobe',
        units: 'mm' as const,
        parameters: {},
        components: [],
        constraints: [],
        groundedComponentPaths: [],
        colors: {},
        bomItemNumbers: {},
        cutListItemNumbers: {},
        colorOverrides: {},
        properties: {},
        materials: [],
        hardware: [],
      },
    } satisfies ProjectFile;

    expect(manifest.kind).toBe('assembly');
    expect(manifest.formatVersion).toBe(14);
  });
});
