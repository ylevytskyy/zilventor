import { describe, it, expect } from 'vitest';
import { CURRENT_FORMAT_VERSION, migrateManifest, type AnyManifest } from '../fileFormat';

describe('fileFormat', () => {
  it('exports a locked current version', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(38);
  });

  it('returns the manifest unchanged when already current', () => {
    const m = { formatVersion: 38, kind: 'part' as const, document: { properties: {}, materials: [] } };
    expect(migrateManifest(m)).toEqual(m);
  });

  it('v10 assembly manifest migrates to v11 with cutListItemNumbers: {}', () => {
    const v10 = {
      formatVersion: 10, kind: 'assembly' as const,
      document: {
        id: 'a1', name: 'A', units: 'mm', parameters: {},
        components: [], constraints: [], groundedComponentPaths: [],
        colors: {}, bomItemNumbers: {}, colorOverrides: {}, materials: [],
      },
    };
    const out = migrateManifest(v10);
    expect(out.formatVersion).toBe(38);
    expect((out.document as { cutListItemNumbers: unknown }).cutListItemNumbers).toEqual({});
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
  it('exports version 7 as current', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(38);
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
    expect(m.formatVersion).toBe(38);
    const doc = m.document as { featureTree: Array<{ primitives: Array<{ id: string }> }> };
    const sketch = doc.featureTree.find((f) => (f as { id?: string }).id === 's1') as { primitives: Array<{ id: string }> };
    expect(sketch.primitives[0]!.id).toBe('s1-p0');
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
    const sketch = doc.featureTree.find((f) => (f as { id?: string }).id === 's1') as { primitives: Array<{ id: string }> };
    expect(sketch.primitives.map((p) => p.id)).toEqual(['s1-p0', 's1-p1']);
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
    const sketch = doc.featureTree.find((f) => (f as { id?: string }).id === 's1') as { primitives: Array<{ id: string }> };
    expect(sketch.primitives[0]!.id).toBe('custom-id');
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

  it('reaches formatVersion 4 via v1 → v2 → v3 → v4 chain', () => {
    const input: AnyManifest = {
      formatVersion: 1,
      document: {
        featureTree: [{ kind: 'sketch', id: 's1', primitives: [{ kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }] }]
      }
    };
    const out = migrateManifest(input);
    expect(out.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(CURRENT_FORMAT_VERSION).toBe(38);
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
    const tree = (out.document as { featureTree: Array<Record<string, unknown>> }).featureTree;
    const sketch = tree.find((f) => f.id === 's1');
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
    const tree = (out.document as { featureTree: Array<Record<string, unknown>> }).featureTree;
    const sketch = tree.find((f) => f.id === 's1');
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
    const tree = (out.document as { featureTree: Array<Record<string, unknown>> }).featureTree;
    const sketch = tree.find((f) => f.id === 's1');
    const constraints = sketch!.constraints as Array<{ kind: string; source?: string }>;
    // 2 horizontals + 2 verticals + 4 coincidents (at each corner) = 8 constraints
    expect(constraints.filter((c) => c.kind === 'horizontal')).toHaveLength(2);
    expect(constraints.filter((c) => c.kind === 'vertical')).toHaveLength(2);
    expect(constraints.filter((c) => c.kind === 'coincident').length).toBeGreaterThanOrEqual(4);
    for (const c of constraints) expect(c.source).toBe('inferred-migration');
  });
});

describe('fileFormat v3 → v4 migration', () => {
  it('v3 manifest round-trips to v4 with parameters untouched', () => {
    const input: AnyManifest = {
      formatVersion: 3,
      document: {
        id: 'P1', name: 'Part1', units: 'mm',
        parameters: { d0: { name: 'd0', expression: '50', value: 50, unit: 'mm' } },
        featureTree: [{ kind: 'sketch', id: 'S1', plane: 'XY', primitives: [], constraints: [] }]
      }
    };
    const out = migrateManifest(input);
    expect(out.formatVersion).toBe(38);
    expect(CURRENT_FORMAT_VERSION).toBe(38);
    const params = (out.document as { parameters: Record<string, unknown> }).parameters;
    expect(params.d0).toEqual({ name: 'd0', expression: '50', value: 50, unit: 'mm' });
  });

  it('v3 manifest without a parameters field gets an empty map on migration', () => {
    const input: AnyManifest = {
      formatVersion: 3,
      document: { featureTree: [] }
    };
    const out = migrateManifest(input);
    expect(out.formatVersion).toBe(38);
    const doc = out.document as { parameters?: Record<string, unknown> };
    expect(doc.parameters).toEqual({});
  });
});

describe('fileFormat v4 → v5 migration', () => {
  it('single-extrude v4 manifest gets operation: new', () => {
    const input: AnyManifest = {
      formatVersion: 4,
      document: {
        id: 'P1', name: 'P', units: 'mm', parameters: {},
        featureTree: [
          { kind: 'sketch', id: 'S1', plane: 'XY', primitives: [], constraints: [] },
          { kind: 'extrude', id: 'E1', sketchRef: 'S1', distanceParam: 'd0', direction: 'forward' }
        ]
      }
    };
    const out = migrateManifest(input);
    expect(out.formatVersion).toBe(38);
    expect(CURRENT_FORMAT_VERSION).toBe(38);
    const tree = (out.document as { featureTree: Array<{ kind: string; operation?: string }> }).featureTree;
    const ex = tree.find((f) => f.kind === 'extrude')!;
    expect(ex.operation).toBe('new');
  });

  it('multi-extrude v4 manifest: first gets new, rest get join', () => {
    const input: AnyManifest = {
      formatVersion: 4,
      document: {
        featureTree: [
          { kind: 'extrude', id: 'E1', sketchRef: 'S1', distanceParam: 'd0', direction: 'forward' },
          { kind: 'extrude', id: 'E2', sketchRef: 'S2', distanceParam: 'd1', direction: 'forward' }
        ]
      }
    };
    const out = migrateManifest(input);
    const tree = (out.document as { featureTree: Array<{ kind: string; operation?: string }> }).featureTree;
    const e1 = tree.find((f) => (f as { id?: string }).id === 'E1') as { operation?: string };
    const e2 = tree.find((f) => (f as { id?: string }).id === 'E2') as { operation?: string };
    expect(e1!.operation).toBe('new');
    expect(e2!.operation).toBe('join');
  });

  it('empty tree migrates without change', () => {
    const input: AnyManifest = { formatVersion: 4, document: { featureTree: [] } };
    const out = migrateManifest(input);
    expect(out.formatVersion).toBe(38);
  });
});

describe('fileFormat v5 → v6 migration', () => {
  it('bumps formatVersion from 5 to 6 without structural change', () => {
    const input: AnyManifest = {
      formatVersion: 5,
      document: {
        id: 'P1', name: 'P', units: 'mm', parameters: {},
        featureTree: [
          { kind: 'sketch', id: 'S1', plane: 'XY', primitives: [], constraints: [] },
          { kind: 'extrude', id: 'E1', sketchRef: 'S1', distanceParam: 'd0', direction: 'forward', operation: 'new' },
        ],
      },
    };
    const out = migrateManifest(input);
    expect(out.formatVersion).toBe(38);
    const tree = (out.document as { featureTree: Array<{ kind: string; id?: string }> }).featureTree;
    const userFeatures = tree.filter((f) => !(typeof f.id === 'string' && f.id.startsWith('origin.')));
    expect(userFeatures).toHaveLength(2);
    expect(userFeatures.map((f) => f.kind)).toEqual(['sketch', 'extrude']);
  });

  it('v5 manifest with mixed features survives migration untouched', () => {
    const input: AnyManifest = {
      formatVersion: 5,
      document: {
        id: 'P1', name: 'P', units: 'mm', parameters: {},
        featureTree: [
          { kind: 'sketch', id: 'S1', plane: 'XY', primitives: [], constraints: [] },
          { kind: 'revolve', id: 'R1', sketchRef: 'S1', axisPrimitiveId: 'L3', angleParam: 'a0', direction: 'normal', operation: 'new' },
        ],
      },
    };
    const out = migrateManifest(input);
    expect(out.formatVersion).toBe(38);
  });
});

describe('fileFormat v6 → v7 migration', () => {
  it('bumps formatVersion from 6 to 7 without structural change', () => {
    const input: AnyManifest = {
      formatVersion: 6,
      document: {
        id: 'P1', name: 'P', units: 'mm', parameters: {},
        featureTree: [
          { kind: 'sketch', id: 'S1', plane: 'XY', primitives: [], constraints: [] },
        ],
      },
    };
    const out = migrateManifest(input);
    expect(out.formatVersion).toBe(38);
    expect(CURRENT_FORMAT_VERSION).toBe(38);
  });

  it('v6 with mixed features survives migration', () => {
    const input: AnyManifest = {
      formatVersion: 6,
      document: {
        id: 'P1', name: 'P', units: 'mm', parameters: {},
        featureTree: [
          { kind: 'extrude', id: 'E1', sketchRef: 'S0', distanceParam: 'd0', direction: 'forward', operation: 'new' },
        ],
      },
    };
    const out = migrateManifest(input);
    expect(out.formatVersion).toBe(38);
  });
});

describe('ProjectFile kind discriminator', () => {
  it('legacy v7 manifest without kind field defaults to kind: part on load', () => {
    const input: AnyManifest = {
      formatVersion: 7,
      document: {
        id: 'P1', name: 'p', units: 'mm', parameters: {},
        featureTree: [],
      },
    };
    const out = migrateManifest(input);
    expect(out.formatVersion).toBe(38);
    expect((out as any).kind).toBe('part');
  });

  it('v7 manifest with kind: assembly is preserved', () => {
    const input: AnyManifest = {
      formatVersion: 7,
      kind: 'assembly',
      document: {
        id: 'A1', name: 'a', units: 'mm', parameters: {}, components: [],
      },
    };
    const out = migrateManifest(input);
    expect(out.formatVersion).toBe(38);
    expect((out as any).kind).toBe('assembly');
  });

  it('v7 manifest with kind: part is preserved', () => {
    const input: AnyManifest = {
      formatVersion: 7,
      kind: 'part',
      document: {
        id: 'P1', name: 'p', units: 'mm', parameters: {},
        featureTree: [],
      },
    };
    const out = migrateManifest(input);
    expect(out.formatVersion).toBe(38);
    expect((out as any).kind).toBe('part');
  });
});

describe('migrateManifest origin features', () => {
  it('legacy v7 part without origin features gets origin features prepended', () => {
    const input: AnyManifest = {
      formatVersion: 7,
      kind: 'part',
      document: {
        id: 'P1', name: 'p', units: 'mm', parameters: {},
        featureTree: [
          { kind: 'sketch', id: 'S1', plane: 'XY', primitives: [], constraints: [] },
        ],
      },
    } as AnyManifest;
    const out = migrateManifest(input);
    const tree = (out.document as { featureTree: Array<{ id: string }> }).featureTree;
    expect(tree[0]!.id).toBe('origin.X');
    expect(tree[1]!.id).toBe('origin.Y');
    expect(tree[2]!.id).toBe('origin.Z');
    expect(tree[3]!.id).toBe('origin.XY');
    expect(tree[4]!.id).toBe('origin.YZ');
    expect(tree[5]!.id).toBe('origin.XZ');
    expect(tree[6]!.id).toBe('origin.O');
    expect(tree[7]!.id).toBe('S1');
  });

  it('manifest with existing origin features is left untouched', () => {
    const input: AnyManifest = {
      formatVersion: 7,
      kind: 'part',
      document: {
        id: 'P1', name: 'p', units: 'mm', parameters: {},
        featureTree: [
          { kind: 'workAxis', id: 'origin.X', visible: false, source: { mode: 'origin', axis: 'X' } },
          { kind: 'workAxis', id: 'origin.Y', visible: false, source: { mode: 'origin', axis: 'Y' } },
          { kind: 'workAxis', id: 'origin.Z', visible: false, source: { mode: 'origin', axis: 'Z' } },
          { kind: 'workPlane', id: 'origin.XY', visible: false, source: { mode: 'origin', plane: 'XY' } },
          { kind: 'workPlane', id: 'origin.YZ', visible: false, source: { mode: 'origin', plane: 'YZ' } },
          { kind: 'workPlane', id: 'origin.XZ', visible: false, source: { mode: 'origin', plane: 'XZ' } },
          { kind: 'workPoint', id: 'origin.O', visible: false, source: { mode: 'origin' } },
        ],
      },
    } as AnyManifest;
    const out = migrateManifest(input);
    const tree = (out.document as { featureTree: Array<unknown> }).featureTree;
    expect(tree.length).toBe(7);
  });

  it('assembly manifests are untouched (no origin features)', () => {
    const input: AnyManifest = {
      formatVersion: 7,
      kind: 'assembly',
      document: { id: 'A1', name: 'a', units: 'mm', parameters: {}, components: [] },
    } as AnyManifest;
    const out = migrateManifest(input);
    expect((out.document as { components: unknown[] }).components).toEqual([]);
    expect((out.document as Record<string, unknown>).featureTree).toBeUndefined();
  });

  it('part manifest without document migrates to current version', () => {
    const m = { formatVersion: 22, kind: 'part' as const };
    expect(migrateManifest(m).formatVersion).toBe(38);
  });
});

describe('migrateManifest sketch.plane migration', () => {
  it('migrates plane: "XY" to { source: "workPlane", featureId: "origin.XY" }', () => {
    const input: AnyManifest = {
      formatVersion: 7, kind: 'part',
      document: {
        id: 'P1', name: 'p', units: 'mm', parameters: {},
        featureTree: [
          { kind: 'sketch', id: 'S1', plane: 'XY', primitives: [], constraints: [] },
        ],
      },
    } as AnyManifest;
    const out = migrateManifest(input);
    const tree = (out.document as { featureTree: Array<Record<string, unknown>> }).featureTree;
    const sketch = tree.find((f) => f.id === 'S1') as { plane: unknown };
    expect(sketch.plane).toEqual({ source: 'workPlane', featureId: 'origin.XY' });
  });

  it('migrates plane: "YZ" and "XZ" to matching origin work plane refs', () => {
    const input: AnyManifest = {
      formatVersion: 7, kind: 'part',
      document: {
        id: 'P1', name: 'p', units: 'mm', parameters: {},
        featureTree: [
          { kind: 'sketch', id: 'S1', plane: 'YZ', primitives: [], constraints: [] },
          { kind: 'sketch', id: 'S2', plane: 'XZ', primitives: [], constraints: [] },
        ],
      },
    } as AnyManifest;
    const out = migrateManifest(input);
    const tree = (out.document as { featureTree: Array<Record<string, unknown>> }).featureTree;
    const s1 = tree.find((f) => f.id === 'S1') as { plane: unknown };
    const s2 = tree.find((f) => f.id === 'S2') as { plane: unknown };
    expect(s1.plane).toEqual({ source: 'workPlane', featureId: 'origin.YZ' });
    expect(s2.plane).toEqual({ source: 'workPlane', featureId: 'origin.XZ' });
  });

  it('leaves WorkPlaneRef sketches untouched', () => {
    const planeRef = { source: 'workPlane', featureId: 'origin.YZ' };
    const input: AnyManifest = {
      formatVersion: 7, kind: 'part',
      document: {
        id: 'P1', name: 'p', units: 'mm', parameters: {},
        featureTree: [
          { kind: 'sketch', id: 'S1', plane: planeRef, primitives: [], constraints: [] },
        ],
      },
    } as AnyManifest;
    const out = migrateManifest(input);
    const tree = (out.document as { featureTree: Array<Record<string, unknown>> }).featureTree;
    const sketch = tree.find((f) => f.id === 'S1') as { plane: unknown };
    expect(sketch.plane).toEqual(planeRef);
  });
});

describe('migrateManifest 4b backfill', () => {
  it('defaults constraints/groundedComponentPaths and pose for legacy v7 assemblies', () => {
    const input = {
      formatVersion: 7,
      kind: 'assembly',
      document: {
        id: 'A', name: 'a', units: 'mm', parameters: {},
        components: [
          { id: 'C1', partPath: 'p.zipt', position: { x: 1, y: 2, z: 3 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        ],
      },
    };
    const out = migrateManifest(input as any) as any;
    expect(out.document.constraints).toEqual([]);
    expect(out.document.groundedComponentPaths).toEqual([]);
    expect(out.document.components[0].pose.translation).toEqual({ x: 1, y: 2, z: 3 });
    expect(out.document.components[0].pose.quaternion).toEqual([0, 0, 0, 1]);
  });
  it('preserves existing constraints / groundedComponentPaths / pose', () => {
    const input = {
      formatVersion: 7,
      kind: 'assembly',
      document: {
        id: 'A', name: 'a', units: 'mm', parameters: {},
        components: [
          { id: 'C1', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true,
            pose: { translation: { x: 5, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
        ],
        constraints: [{ id: 'k1', kind: 'mate', refA: {} as any, refB: {} as any, offset: { kind: 'literal', value: 0 }, suppressed: false }],
        groundedComponentIds: ['C1'],
      },
    };
    const out = migrateManifest(input as any) as any;
    expect(out.document.constraints).toHaveLength(1);
    expect(out.document.groundedComponentPaths).toEqual([['C1']]);
    expect(out.document.components[0].pose.translation.x).toBe(5);
  });

  it('produces correct quaternion for 90° rotation around X', () => {
    const input = {
      formatVersion: 7,
      kind: 'assembly',
      document: {
        id: 'A', name: 'a', units: 'mm', parameters: {},
        components: [
          { id: 'C1', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 90, ry: 0, rz: 0 }, visible: true },
        ],
      },
    };
    const out = migrateManifest(input as any) as any;
    const q = out.document.components[0].pose.quaternion;
    expect(q[0]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(q[1]).toBeCloseTo(0, 9);
    expect(q[2]).toBeCloseTo(0, 9);
    expect(q[3]).toBeCloseTo(Math.SQRT1_2, 9);
  });
});

describe('migrateManifest 4c backfill', () => {
  it('defaults colors and bomItemNumbers for legacy v7 assembly manifests', () => {
    const legacy = {
      formatVersion: 7,
      kind: 'assembly',
      createdAt: '2026-01-01',
      appVersion: '0.0.0',
      document: {
        id: 'A', name: 'A', units: 'mm', parameters: {},
        components: [], constraints: [], groundedComponentIds: [],
      },
    };
    const m = migrateManifest(legacy as any) as any;
    expect(m.kind).toBe('assembly');
    expect(m.document.colors).toEqual({});
    expect(m.document.bomItemNumbers).toEqual({});
  });
});

// ── HIGH #3: backfillDrawingF5 must not mutate input ─────────────────────────
describe('backfillDrawingF5 — immutability', () => {
  function makeV18DrawingWithoutGroups() {
    return {
      formatVersion: 18 as const,
      kind: 'drawing' as const,
      document: {
        id: 'drw1', name: 'D', units: 'mm' as const,
        source: { partPath: 'p.zipt', sourceKind: 'part' as const },
        properties: {}, activeSheetId: 's1',
        sheets: [
          { id: 's1', name: 'S1', size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
            views: [], dimensions: [], annotations: [], titleBlock: {} },
          { id: 's2', name: 'S2', size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
            views: [], dimensions: [], annotations: [], titleBlock: {} },
        ],
      },
    } as unknown as AnyManifest;
  }

  it('returned object is not === input', () => {
    const input = makeV18DrawingWithoutGroups();
    const output = migrateManifest(input);
    expect(output).not.toBe(input);
  });

  it('input sheets still lack dimensionGroups after migrate (original not mutated)', () => {
    const input = makeV18DrawingWithoutGroups();
    const inputSheets = (input as any).document.sheets as Array<Record<string, unknown>>;
    migrateManifest(input);
    // If backfill mutated in place, inputSheets[0] would now have dimensionGroups
    expect('dimensionGroups' in inputSheets[0]!).toBe(false);
    expect('dimensionGroups' in inputSheets[1]!).toBe(false);
  });

  it('output sheets have dimensionGroups: [] on both sheets', () => {
    const input = makeV18DrawingWithoutGroups();
    const output = migrateManifest(input) as any;
    const sheets = output.document.sheets as Array<Record<string, unknown>>;
    expect(sheets[0]!['dimensionGroups']).toEqual([]);
    expect(sheets[1]!['dimensionGroups']).toEqual([]);
  });

  it('does not overwrite existing dimensionGroups value', () => {
    const input = makeV18DrawingWithoutGroups() as any;
    input.document.sheets[0].dimensionGroups = [{ id: 'grp1', kind: 'baseline', viewId: 'v1', dimIds: [], baseOffsetMm: 5, spacingMm: 5 }];
    const output = migrateManifest(input) as any;
    expect(output.document.sheets[0].dimensionGroups).toHaveLength(1);
  });
});

describe('fileFormat v22 → v23', () => {
  it('CURRENT_FORMAT_VERSION is now 24', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(38);
  });

  it('a v22 part manifest migrates to v23 without adding edited/jointDir/suppressedConnectorIds', () => {
    const v22: AnyManifest = {
      formatVersion: 22,
      kind: 'part',
      document: {
        id: 'p1', name: 'Panel', units: 'mm', parameters: {},
        featureTree: [], properties: {}, materials: [], hardware: [],
        bores: [
          {
            id: 'c0-face', face: { featureId: 'panel', role: 'Left', instance: 0 },
            u: 32, v: 100, diameter: 7, depth: 12,
            role: 'confirmat-face', connectorId: 'confirmat-0', connectorKind: 'confirmat',
          },
        ],
      },
    };
    const out = migrateManifest(v22);
    expect(out.formatVersion).toBe(38);
    const doc = out.document as {
      bores?: Array<Record<string, unknown>>;
      suppressedConnectorIds?: unknown;
    };
    // suppressedConnectorIds must be absent (not reified as [] or null)
    expect('suppressedConnectorIds' in doc).toBe(false);
    // bores must be unchanged
    expect(doc.bores).toHaveLength(1);
    const bore = doc.bores![0]!;
    // edited must be absent (not false)
    expect('edited' in bore).toBe(false);
    // jointDir must be absent (not undefined / null / {x:0,y:0,z:0})
    expect('jointDir' in bore).toBe(false);
  });

  it('a v22 assembly manifest migrates to v23 unchanged (no suppressedConnectorIds injected)', () => {
    const v22: AnyManifest = {
      formatVersion: 22,
      kind: 'assembly',
      document: {
        id: 'a1', name: 'Cab', units: 'mm', parameters: {},
        components: [], constraints: [], groundedComponentPaths: [],
        colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
        properties: {}, materials: [], hardware: [],
      },
    };
    const out = migrateManifest(v22);
    expect(out.formatVersion).toBe(38);
    const doc = out.document as Record<string, unknown>;
    expect('suppressedConnectorIds' in doc).toBe(false);
  });

  it('a v23 manifest passes through migrateManifest unchanged', () => {
    const v23: AnyManifest = {
      formatVersion: 23,
      kind: 'part',
      document: { id: 'p', name: 'P', units: 'mm', parameters: {}, featureTree: [], properties: {}, materials: [], hardware: [] },
    };
    const out = migrateManifest(v23);
    expect(out.formatVersion).toBe(38);
  });

  it('a v23 manifest does NOT throw in normalizeKind (formatVersion recognised)', () => {
    const v23: AnyManifest = {
      formatVersion: 23,
      // kind deliberately absent to trigger normalizeKind
      document: { properties: {}, materials: [] },
    };
    expect(() => migrateManifest(v23)).not.toThrow();
    expect(migrateManifest(v23).formatVersion).toBe(38);
  });
});

describe('fileFormat v37 → v38', () => {
  it('bumps formatVersion from 37 to 38 without structural mutation to unrelated fields', () => {
    const v37: AnyManifest = {
      formatVersion: 37,
      kind: 'part',
      document: {
        id: 'p', name: 'P', units: 'mm', parameters: {},
        // Already has origin features so injectOriginFeatures (an unrelated, unconditional
        // backfill step) is a no-op — isolates this assertion to the v37→v38 step itself.
        featureTree: [
          { kind: 'workAxis', id: 'origin.X', visible: false, source: { mode: 'origin', axis: 'X' } },
          { kind: 'workAxis', id: 'origin.Y', visible: false, source: { mode: 'origin', axis: 'Y' } },
          { kind: 'workAxis', id: 'origin.Z', visible: false, source: { mode: 'origin', axis: 'Z' } },
          { kind: 'workPlane', id: 'origin.XY', visible: false, source: { mode: 'origin', plane: 'XY' } },
          { kind: 'workPlane', id: 'origin.YZ', visible: false, source: { mode: 'origin', plane: 'YZ' } },
          { kind: 'workPlane', id: 'origin.XZ', visible: false, source: { mode: 'origin', plane: 'XZ' } },
          { kind: 'workPoint', id: 'origin.O', visible: false, source: { mode: 'origin' } },
        ],
        properties: {}, materials: [], hardware: [],
      },
    };
    const out = migrateManifest(v37);
    expect(out.formatVersion).toBe(38);
    expect(out.document).toEqual(v37.document);
  });
});


