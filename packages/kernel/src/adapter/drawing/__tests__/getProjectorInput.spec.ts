import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../../../occt/occtLoader';
import { executeTree } from '../../FeatureTree';
import { getProjectorInput } from '../getProjectorInput';
import type { OcctInstance } from '../../../occt/occtLoader';
import { createKernelApi } from '../../../api';

let oc: OcctInstance;

beforeAll(async () => {
  oc = await loadOcct();
}, 30_000);

describe('getProjectorInput — part source', () => {
  it('returns triangles, edges, and bbox for a 100×60×40 box', async () => {
    const part = {
      id: 'box-fixture',
      name: 'BoxFixture',
      units: 'mm' as const,
      parameters: {
        d1: { name: 'd1', expression: '40', value: 40, unit: 'mm' as const },
      },
      properties: {},
      materials: [],
      hardware: [],
      featureTree: [
        {
          kind: 'sketch' as const,
          id: 'sk1',
          plane: { source: 'workPlane', featureId: 'origin.XY' } as const,
          primitives: [{ id: 'r1', kind: 'rectangle' as const, x: 0, y: 0, w: 100, h: 60 }],
          constraints: [],
        },
        {
          kind: 'extrude' as const,
          id: 'ex1',
          sketchRef: 'sk1',
          distanceParam: 'd1',
          direction: 'forward' as const,
          operation: 'new' as const,
        },
      ],
    };

    const execResult = await executeTree(oc, part);
    expect(execResult.ok).toBe(true);
    if (!execResult.ok) return;

    const ns = execResult.value.namedShape;
    const input = await getProjectorInput(
      oc,
      { kind: 'part', partId: 'box-fixture' },
      () => ns,
    );

    // triangles: a box has 12 triangles (2 per face × 6 faces)
    expect(input.triangles.length).toBeGreaterThanOrEqual(12);

    // edges: a box has 12 edges — each should appear in tessellateEdges output
    expect(input.edges.length).toBeGreaterThanOrEqual(12);

    // bbox: roughly matches the 100×60×40 box
    expect(input.bbox[3] - input.bbox[0]).toBeCloseTo(100, 0);
    expect(input.bbox[4] - input.bbox[1]).toBeCloseTo(60, 0);
    expect(input.bbox[5] - input.bbox[2]).toBeCloseTo(40, 0);
  });
});

// --- Assembly source tests ---

describe('getProjectorInput — assembly source', () => {
  const IDENTITY_POSE = {
    translation: { x: 0, y: 0, z: 0 },
    quaternion: [0, 0, 0, 1] as [number, number, number, number],
  };

  function makeBoxPart(id: string) {
    return {
      id,
      name: id,
      units: 'mm' as const,
      parameters: {
        d1: { name: 'd1', expression: '40', value: 40, unit: 'mm' as const },
      },
      properties: {},
      materials: [],
      hardware: [],
      featureTree: [
        {
          kind: 'sketch' as const,
          id: 'sk1',
          plane: { source: 'workPlane', featureId: 'origin.XY' } as const,
          primitives: [{ id: 'r1', kind: 'rectangle' as const, x: 0, y: 0, w: 100, h: 60 }],
          constraints: [],
        },
        {
          kind: 'extrude' as const,
          id: 'ex1',
          sketchRef: 'sk1',
          distanceParam: 'd1',
          direction: 'forward' as const,
          operation: 'new' as const,
        },
      ],
    };
  }

  it('returns concatenated triangles for assembly with two boxes at different poses', async () => {
    const resA = await executeTree(oc, makeBoxPart('box-asm-a'));
    const resB = await executeTree(oc, makeBoxPart('box-asm-b'));
    expect(resA.ok).toBe(true);
    expect(resB.ok).toBe(true);
    if (!resA.ok || !resB.ok) return;

    const nsA = resA.value.namedShape;
    const nsB = resB.value.namedShape;
    const cache = new Map([['box-asm-a', nsA], ['box-asm-b', nsB]]);

    const singleInput = await getProjectorInput(
      oc,
      { kind: 'part', partId: 'box-asm-a' },
      (id) => cache.get(id),
    );
    const perBoxCount = singleInput.triangles.length;

    const asmInput = await getProjectorInput(
      oc,
      {
        kind: 'assembly',
        components: [
          { partId: 'box-asm-a', pose: IDENTITY_POSE },
          { partId: 'box-asm-b', pose: { translation: { x: 200, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
        ],
      },
      (id) => cache.get(id),
    );

    // ~2× the per-box triangle count
    expect(asmInput.triangles.length).toBeGreaterThanOrEqual(perBoxCount * 2);

    // bbox x-extent: box A at x=0..100, box B at x=200..300 → total ~300
    expect(asmInput.bbox[3] - asmInput.bbox[0]).toBeCloseTo(300, 0);
  });

  it('processes all components in the list (suppression is caller responsibility)', async () => {
    const resA = await executeTree(oc, makeBoxPart('box-asm-supp-a'));
    const resB = await executeTree(oc, makeBoxPart('box-asm-supp-b'));
    expect(resA.ok).toBe(true);
    expect(resB.ok).toBe(true);
    if (!resA.ok || !resB.ok) return;

    const cache = new Map([
      ['box-asm-supp-a', resA.value.namedShape],
      ['box-asm-supp-b', resB.value.namedShape],
    ]);

    // Kernel does NOT filter — both entries are processed
    const asmInput = await getProjectorInput(
      oc,
      {
        kind: 'assembly',
        components: [
          { partId: 'box-asm-supp-a', pose: IDENTITY_POSE },
          { partId: 'box-asm-supp-b', pose: IDENTITY_POSE },
        ],
      },
      (id) => cache.get(id),
    );
    expect(asmInput.triangles.length).toBeGreaterThanOrEqual(24); // both boxes included
  });

  it('throws when a partId is not in the cache', async () => {
    await expect(
      getProjectorInput(
        oc,
        {
          kind: 'assembly',
          components: [{ partId: 'ghost', pose: IDENTITY_POSE }],
        },
        () => undefined,
      ),
    ).rejects.toThrow(/ghost.*cache/i);
  });
});

// --- API surface tests ---

describe('KernelApi.getProjectorInput', () => {
  it('returns ProjectorInput via the kernel API surface after execute', async () => {
    const api = createKernelApi();
    await api.init();

    const partId = await api.createPart('box-api-test');
    await api.setParameter(partId, { name: 'd1', expression: '40', value: 40, unit: 'mm' });
    await api.addFeature(partId, {
      kind: 'sketch', id: 'sk1',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [{ id: 'r1', kind: 'rectangle', x: 0, y: 0, w: 100, h: 60 }],
      constraints: [],
    });
    await api.addFeature(partId, {
      kind: 'extrude', id: 'ex1', sketchRef: 'sk1',
      distanceParam: 'd1',
      direction: 'forward', operation: 'new',
    });
    await api.execute(partId);

    const input = await api.getProjectorInput({ kind: 'part', partId });
    expect(input).not.toBeNull();
    expect(input!.triangles.length).toBeGreaterThanOrEqual(12);
    expect(input!.edges.length).toBeGreaterThanOrEqual(12);
    expect(input!.bbox[3] - input!.bbox[0]).toBeCloseTo(100, 0);
  }, 120_000);

  it('returns null for an unexecuted part (cold cache)', async () => {
    const api = createKernelApi();
    await api.init();
    const partId = await api.createPart('cold-test');
    const input = await api.getProjectorInput({ kind: 'part', partId });
    expect(input).toBeNull();
  }, 60_000);
});
