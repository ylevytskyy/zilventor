// packages/shared/src/drawing/__tests__/fingerprint.spec.ts
import { describe, it, expect } from 'vitest';
import { computeViewFingerprint, computeSourceGeometryHash } from '../fingerprint';
import type { ProjectorInput } from '../projector';

const BASE_INPUT: ProjectorInput = {
  triangles: [[[0,0,0],[1,0,0],[0,1,0]]],
  edges: [{ id: 'e0', points: [[0,0,0],[1,0,0]], adjacentFaces: [] }],
  bbox: [0, 0, 0, 1, 1, 0],
};

const BASE_VIEW_SPEC = {
  orientation: 'front' as const,
  scale: { numerator: 1, denominator: 1 },
  showHidden: true,
};

describe('computeSourceGeometryHash', () => {
  it('same input → same hash', async () => {
    const h1 = await computeSourceGeometryHash(BASE_INPUT.triangles, BASE_INPUT.edges);
    const h2 = await computeSourceGeometryHash(BASE_INPUT.triangles, BASE_INPUT.edges);
    expect(h1).toBe(h2);
  });

  it('returns a 64-char hex string (SHA-256)', async () => {
    const h = await computeSourceGeometryHash(BASE_INPUT.triangles, BASE_INPUT.edges);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('perturbation > 1e-3 mm → different hash', async () => {
    const perturbed: ProjectorInput = {
      ...BASE_INPUT,
      triangles: [[[0,0,0],[1.01,0,0],[0,1,0]]],  // 10mm perturbation
    };
    const h1 = await computeSourceGeometryHash(BASE_INPUT.triangles, BASE_INPUT.edges);
    const h2 = await computeSourceGeometryHash(perturbed.triangles, perturbed.edges);
    expect(h1).not.toBe(h2);
  });

  it('perturbation < 1e-3 mm → same hash (rounding bucket)', async () => {
    const perturbed: ProjectorInput = {
      ...BASE_INPUT,
      triangles: [[[0,0,0],[1.0001,0,0],[0,1,0]]],  // 0.1µm — below threshold
    };
    const h1 = await computeSourceGeometryHash(BASE_INPUT.triangles, BASE_INPUT.edges);
    const h2 = await computeSourceGeometryHash(perturbed.triangles, perturbed.edges);
    expect(h1).toBe(h2);
  });
});

describe('computeViewFingerprint', () => {
  it('same viewSpec + source → same fingerprint', async () => {
    const f1 = await computeViewFingerprint(BASE_VIEW_SPEC, BASE_INPUT);
    const f2 = await computeViewFingerprint(BASE_VIEW_SPEC, BASE_INPUT);
    expect(f1).toBe(f2);
  });

  it('different orientation → different fingerprint', async () => {
    const f1 = await computeViewFingerprint(BASE_VIEW_SPEC, BASE_INPUT);
    const f2 = await computeViewFingerprint({ ...BASE_VIEW_SPEC, orientation: 'top' }, BASE_INPUT);
    expect(f1).not.toBe(f2);
  });

  it('returns 64-char hex string', async () => {
    const f = await computeViewFingerprint(BASE_VIEW_SPEC, BASE_INPUT);
    expect(f).toMatch(/^[0-9a-f]{64}$/);
  });
});
