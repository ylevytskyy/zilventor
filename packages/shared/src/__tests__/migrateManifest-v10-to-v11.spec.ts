import { describe, expect, it } from 'vitest';
import { migrateManifest } from '../fileFormat';

describe('migrateManifest v10 → v11', () => {
  it('adds cutListItemNumbers: {} to assembly manifests missing the field', () => {
    const v10 = {
      formatVersion: 10,
      kind: 'assembly',
      document: {
        id: 'a1',
        name: 'A',
        units: 'mm',
        parameters: {},
        components: [],
        constraints: [],
        groundedComponentPaths: [],
        colors: {},
        bomItemNumbers: {},
        colorOverrides: {},
        materials: [],
      },
    };
    const m = migrateManifest(v10);
    expect(m.formatVersion).toBe(21);
    const doc = m.document as { cutListItemNumbers: unknown };
    expect(doc.cutListItemNumbers).toEqual({});
  });

  it('preserves existing cutListItemNumbers if already present (idempotent)', () => {
    const v10 = {
      formatVersion: 10,
      kind: 'assembly',
      document: {
        id: 'a1',
        cutListItemNumbers: { 'k1': 7 },
      },
    } as never;
    const m = migrateManifest(v10);
    expect((m.document as { cutListItemNumbers: Record<string, number> }).cutListItemNumbers).toEqual({ 'k1': 7 });
  });

  it('passes part manifests through (only formatVersion bumps)', () => {
    const v10 = {
      formatVersion: 10,
      kind: 'part',
      document: { id: 'p1', materials: [] },
    };
    const m = migrateManifest(v10);
    expect(m.formatVersion).toBe(21);
    expect((m.document as Record<string, unknown>).cutListItemNumbers).toBeUndefined();
  });
});
