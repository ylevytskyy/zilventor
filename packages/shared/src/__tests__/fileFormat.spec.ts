import { describe, it, expect } from 'vitest';
import { CURRENT_FORMAT_VERSION, migrateManifest, type AnyManifest } from '../fileFormat';

describe('fileFormat', () => {
  it('exports a locked current version', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(3);
  });

  it('returns the manifest unchanged when already current', () => {
    const m = { formatVersion: 3, kind: 'part' as const };
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
  it('exports version 3 as current', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(3);
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
    expect(m.formatVersion).toBe(3);
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

describe('fileFormat migrations', () => {
  it('v1 manifest does not have its input mutated in place (regression)', () => {
    const input: AnyManifest = {
      formatVersion: 1,
      document: {
        featureTree: [{ kind: 'sketch', id: 's1', primitives: [{ kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }] }]
      }
    };
    const snapshot = JSON.stringify(input);
    migrateManifest(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('reaches formatVersion 3 via v1 → v2 → v3 chain', () => {
    const input: AnyManifest = {
      formatVersion: 1,
      document: {
        featureTree: [{ kind: 'sketch', id: 's1', primitives: [{ kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }] }]
      }
    };
    const out = migrateManifest(input);
    expect(out.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(CURRENT_FORMAT_VERSION).toBe(3);
  });

  it('v2 → v3 seeds constraints on sketches that have none', () => {
    const input: AnyManifest = {
      formatVersion: 2,
      document: {
        featureTree: [
          { kind: 'sketch', id: 's1', plane: 'XY',
            primitives: [{ id: 'p1', kind: 'line', x1: 0, y1: 5, x2: 10, y2: 5 }] }
        ]
      }
    };
    const out = migrateManifest(input);
    const sketch = (out.document as { featureTree: Array<Record<string, unknown>> }).featureTree[0];
    const constraints = sketch!.constraints as Array<{ kind: string; source?: string }>;
    expect(constraints.some((c) => c.kind === 'horizontal')).toBe(true);
    for (const c of constraints) expect(c.source).toBe('inferred-migration');
  });

  it('v2 → v3 preserves existing constraints if already present', () => {
    const input: AnyManifest = {
      formatVersion: 2,
      document: {
        featureTree: [
          { kind: 'sketch', id: 's1', plane: 'XY', primitives: [],
            constraints: [{ id: 'c1', kind: 'horizontal', line: 'p1' }] }
        ]
      }
    };
    const out = migrateManifest(input);
    const sketch = (out.document as { featureTree: Array<Record<string, unknown>> }).featureTree[0];
    expect((sketch!.constraints as unknown[])).toHaveLength(1);
  });
});

describe('v2 → v3 with rectangle-as-4-lines infers H/V + coincident', () => {
  it('migrates a v2 sketch with 4 lines forming a rectangle', () => {
    const v2 = {
      formatVersion: 2,
      document: {
        featureTree: [
          { kind: 'sketch', id: 's1', plane: 'XY',
            primitives: [
              { id: 'L1', kind: 'line', x1: 0,   y1: 0,   x2: 100, y2: 0   },  // H-bottom
              { id: 'L2', kind: 'line', x1: 100, y1: 0,   x2: 100, y2: 50  },  // V-right
              { id: 'L3', kind: 'line', x1: 100, y1: 50,  x2: 0,   y2: 50  },  // H-top
              { id: 'L4', kind: 'line', x1: 0,   y1: 50,  x2: 0,   y2: 0   }   // V-left
            ]
          }
        ]
      }
    } as const;
    const out = migrateManifest(v2 as unknown as Parameters<typeof migrateManifest>[0]);
    const sketch = (out.document as { featureTree: Array<Record<string, unknown>> }).featureTree[0];
    const constraints = sketch!.constraints as Array<{ kind: string; source?: string }>;
    // 2 horizontals + 2 verticals + 4 coincidents (at each corner) = 8 constraints
    expect(constraints.filter((c) => c.kind === 'horizontal')).toHaveLength(2);
    expect(constraints.filter((c) => c.kind === 'vertical')).toHaveLength(2);
    expect(constraints.filter((c) => c.kind === 'coincident').length).toBeGreaterThanOrEqual(4);
    for (const c of constraints) expect(c.source).toBe('inferred-migration');
  });
});
