import { describe, it, expect } from 'vitest';
import { CURRENT_FORMAT_VERSION, migrateManifest, type AnyManifest } from '../fileFormat';

describe('fileFormat', () => {
  it('exports a locked current version', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(2);
  });

  it('returns the manifest unchanged when already current', () => {
    const m = { formatVersion: 2, kind: 'part' as const };
    expect(migrateManifest(m)).toEqual(m);
  });

  it('throws a typed error when the manifest is from a newer version', () => {
    const m = { formatVersion: 99, kind: 'part' as const };
    expect(() => migrateManifest(m)).toThrow(/newer/i);
  });

  it('throws when formatVersion is missing', () => {
    expect(() => migrateManifest({} as unknown as { formatVersion: number })).toThrow(/formatVersion/);
  });
});

describe('fileFormat v1 → v2', () => {
  it('exports version 2 as current', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(2);
  });

  it('migrates a v1 manifest (rectangle without id) to v2 with synthesized id', () => {
    const v1 = {
      formatVersion: 1,
      kind: 'part' as const,
      document: {
        id: 'p1',
        name: 'Part1',
        units: 'mm',
        parameters: {},
        featureTree: [
          { kind: 'sketch', id: 's1', plane: 'XY', primitives: [{ kind: 'rectangle', x: 0, y: 0, w: 100, h: 200 }] }
        ]
      }
    } as unknown as AnyManifest;
    const m = migrateManifest(v1);
    expect(m.formatVersion).toBe(2);
    const doc = m.document as { featureTree: Array<{ primitives: Array<{ id: string }> }> };
    expect(doc.featureTree[0]!.primitives[0]!.id).toBe('s1-p0');
  });

  it('synthesizes unique ids per-primitive within a sketch', () => {
    const v1 = {
      formatVersion: 1,
      kind: 'part' as const,
      document: {
        id: 'p1', name: 'P', units: 'mm', parameters: {},
        featureTree: [
          { kind: 'sketch', id: 's1', plane: 'XY', primitives: [
            { kind: 'rectangle', x: 0, y: 0, w: 10, h: 10 },
            { kind: 'circle', cx: 50, cy: 50, r: 5 }
          ] }
        ]
      }
    } as unknown as AnyManifest;
    const m = migrateManifest(v1);
    const doc = m.document as { featureTree: Array<{ primitives: Array<{ id: string }> }> };
    expect(doc.featureTree[0]!.primitives.map((p) => p.id)).toEqual(['s1-p0', 's1-p1']);
  });

  it('does NOT overwrite existing ids on primitives that already have them', () => {
    const v1Partial = {
      formatVersion: 1,
      kind: 'part' as const,
      document: {
        id: 'p1', name: 'P', units: 'mm', parameters: {},
        featureTree: [
          { kind: 'sketch', id: 's1', plane: 'XY', primitives: [
            { id: 'custom-id', kind: 'rectangle', x: 0, y: 0, w: 10, h: 10 }
          ] }
        ]
      }
    } as unknown as AnyManifest;
    const m = migrateManifest(v1Partial);
    const doc = m.document as { featureTree: Array<{ primitives: Array<{ id: string }> }> };
    expect(doc.featureTree[0]!.primitives[0]!.id).toBe('custom-id');
  });

  it('throws "no migration from formatVersion 0" — exercises the missing-migration path', () => {
    const bad = { formatVersion: 0, kind: 'part' } as AnyManifest;
    expect(() => migrateManifest(bad)).toThrow(/no migration from formatVersion 0/);
  });
});
