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

// LOCKING TEST — guards the fix for the hole-rim-edge kernel bug (2026-05-30).
//
// Root cause (now fixed):
//   HoleFeature.ts:executeHoleFeature() used to spread the OLD
//   `runningBody.faceNames` (pre-cut face handles) directly into the new
//   NamedShape without refreshing OCCT face handles after BRepAlgoAPI_Cut.
//   After BRepAlgoAPI_Cut_3 executes inside makeHole(), the top and bottom
//   planar faces of the original box get FRESH OCCT topology handles.  The
//   stale handles in faceNames no longer IsSame-match the new faces, so
//   tessellateEdges() skipped both circular rim edges (findFaceName returned
//   null for the cut faces) and they never reached ProjectorInput.edges.
//
//   Fix: executeHoleFeature now calls mergeFaceNames (exported from
//   occt/FaceNaming.ts) after the hole loop to walk the result shape, re-match
//   surviving faces via IsSame, and assign fresh handles.
//
// See: packages/kernel/src/adapter/features/HoleFeature.ts
//      packages/kernel/src/occt/FaceNaming.ts (mergeFaceNames export)
//      packages/kernel/src/occt/Tessellator.ts tessellateEdges()

describe('getProjectorInput — LOCKING: hole rim edges', () => {
  it('box-with-through-hole projection contains ≥1 arc (circular rim) edge', async () => {
    // Build a 40×40×20 box with a Ø10 through-hole via the production FeatureTree path.
    const part = {
      id: 'holed-box-fixture',
      name: 'HoledBox',
      units: 'mm' as const,
      parameters: {
        boxW: { name: 'boxW', expression: '40', value: 40, unit: 'mm' as const },
        boxH: { name: 'boxH', expression: '40', value: 40, unit: 'mm' as const },
        boxD: { name: 'boxD', expression: '20', value: 20, unit: 'mm' as const },
      },
      properties: {},
      materials: [],
      hardware: [],
      featureTree: [
        {
          kind: 'sketch' as const,
          id: 'sk-box',
          plane: { source: 'workPlane', featureId: 'origin.XY' } as const,
          primitives: [{ id: 'r1', kind: 'rectangle' as const, x: 0, y: 0, w: 40, h: 40 }],
          constraints: [],
        },
        {
          kind: 'extrude' as const,
          id: 'ex-box',
          sketchRef: 'sk-box',
          distanceParam: 'boxD',
          direction: 'forward' as const,
          operation: 'new' as const,
        },
        // Hole via fromSketch: one circle at (20, 20), Ø10, throughAll
        {
          kind: 'sketch' as const,
          id: 'sk-hole',
          plane: { source: 'workPlane', featureId: 'origin.XY' } as const,
          primitives: [{ id: 'c1', kind: 'circle' as const, cx: 20, cy: 20, r: 5 }],
          constraints: [],
        },
        {
          kind: 'hole' as const,
          id: 'hole-1',
          placement: { kind: 'fromSketch' as const, sketchId: 'sk-hole' },
          profile: { kind: 'simple' as const, diameter: { kind: 'literal' as const, value: 10 } },
          termination: { kind: 'throughAll' as const },
          flipAxis: false,
        },
      ],
    };

    const execResult = await executeTree(oc, part);
    expect(execResult.ok, 'part with hole must execute without error').toBe(true);
    if (!execResult.ok) return;

    const ns = execResult.value.namedShape;
    const input = await getProjectorInput(
      oc,
      { kind: 'part', partId: 'holed-box-fixture' },
      () => ns,
    );

    // A 40×40×20 box with 1 through-hole has:
    //   - 4 vertical side edges (box) = 4
    //   - 4 horizontal box edges top + 4 bottom = 8
    //   - 2 circular rim edges (hole top + hole bottom) = 2
    // Total expected ≥ 14 raw edges.  Before the fix, only ~5 are produced
    // (the 4 box verticals + 1 cylinder seam) — no rim circles.
    expect(input.edges.length, 'holed part must produce raw edges').toBeGreaterThan(0);

    // The key assertion: at least 2 edges must have ≥5 points (arc polylines).
    // Straight box edges have exactly 2 points; rim circles from tessellation
    // have many (typically 16–32 depending on angularDeflection=0.3).
    const multiPointEdges = input.edges.filter((e) => e.points.length >= 5);
    expect(
      multiPointEdges.length,
      `Expected ≥2 arc/circular rim edges (≥5 points each) in holed-box projection, ` +
      `but got ${multiPointEdges.length}. ` +
      `Total edges: ${input.edges.length}. ` +
      `This is the locking test for the kernel face-handle staleness bug in ` +
      `HoleFeature.ts:executeHoleFeature() — stale pre-cut faceNames cause ` +
      `tessellateEdges() to skip circular rim edges.`
    ).toBeGreaterThanOrEqual(2);
  }, 120_000);
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

  it('produces globally-unique edge ids when the same partId appears twice (same part, two instances)', async () => {
    // Two components that reference the SAME partId (same part used twice in the assembly,
    // typical for repeated hardware like shelf pins).  Before the fix, both components emit
    // edges prefixed with comp.partId, so identical edge labels from the shared part topology
    // collide → React duplicate-key warning → potential render omissions.
    const resShared = await executeTree(oc, makeBoxPart('box-shared'));
    expect(resShared.ok).toBe(true);
    if (!resShared.ok) return;

    const ns = resShared.value.namedShape;
    const cache = new Map([['box-shared', ns]]);

    const asmInput = await getProjectorInput(
      oc,
      {
        kind: 'assembly',
        components: [
          // Same partId, different poses → simulates a repeated component (e.g. screw × 2).
          { partId: 'box-shared', pose: IDENTITY_POSE },
          { partId: 'box-shared', pose: { translation: { x: 200, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
        ],
      },
      (id) => cache.get(id),
    );

    const ids = asmInput.edges.map((e) => e.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length); // all edge ids must be globally unique
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
