// packages/shared/src/drawing/__tests__/fingerprint.spec.ts
import { describe, it, expect } from 'vitest';
import { computeViewFingerprint, computeSourceGeometryHash, fingerprintDetailView, fingerprintBreaksArray } from '../fingerprint';
import type { BreakRegion } from '../types';
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

describe('fingerprintDetailView', () => {
  const region = { center: { x: 10, y: 8 }, radiusMm: 5 };
  const scale = { numerator: 2, denominator: 1 };
  const parentFp = 'abc123parent';

  it('same inputs twice → identical string', () => {
    const fp1 = fingerprintDetailView(parentFp, region, scale);
    const fp2 = fingerprintDetailView(parentFp, region, scale);
    expect(fp1).toBe(fp2);
  });

  it('result is a non-empty hex string', () => {
    const fp = fingerprintDetailView(parentFp, region, scale);
    expect(fp).toMatch(/^[0-9a-f]{8}$/);
  });

  it('different parentInputFingerprint → different result', () => {
    const fp1 = fingerprintDetailView('fp-abc', region, scale);
    const fp2 = fingerprintDetailView('fp-xyz', region, scale);
    expect(fp1).not.toBe(fp2);
  });

  it('center.x changed by 0.001 mm → different fingerprint', () => {
    const regionB = { center: { x: 10.001, y: 8 }, radiusMm: 5 };
    const fp1 = fingerprintDetailView(parentFp, region, scale);
    const fp2 = fingerprintDetailView(parentFp, regionB, scale);
    expect(fp1).not.toBe(fp2);
  });

  it('center.x changed by 0.0001 mm → same fingerprint (below 1e-3 threshold)', () => {
    // 10.000 and 10.0001 both round to "10.000" via .toFixed(3)
    const regionB = { center: { x: 10.0001, y: 8 }, radiusMm: 5 };
    const fp1 = fingerprintDetailView(parentFp, region, scale);
    const fp2 = fingerprintDetailView(parentFp, regionB, scale);
    expect(fp1).toBe(fp2);
  });

  it('different scale.numerator → different fingerprint', () => {
    const scale2 = { numerator: 4, denominator: 1 };
    const fp1 = fingerprintDetailView(parentFp, region, scale);
    const fp2 = fingerprintDetailView(parentFp, region, scale2);
    expect(fp1).not.toBe(fp2);
  });

  it('different radiusMm → different fingerprint', () => {
    const regionB = { center: { x: 10, y: 8 }, radiusMm: 6 };
    const fp1 = fingerprintDetailView(parentFp, region, scale);
    const fp2 = fingerprintDetailView(parentFp, regionB, scale);
    expect(fp1).not.toBe(fp2);
  });
});

// ---------------------------------------------------------------------------
// T2.15 — fingerprintBreaksArray (spec §8.1)
// ---------------------------------------------------------------------------

describe('fingerprintBreaksArray (T2.15 — spec §8.1)', () => {
  const mkBreak = (axis: 'x' | 'y', coordA: number, coordB: number, gapMm = 5): BreakRegion => ({
    id: 'test-id',
    axis,
    coordA,
    coordB,
    gapMm,
    style: 'zigzag',
  });

  it('T2.15a empty array → stable non-empty 8-char hex string', () => {
    const fp = fingerprintBreaksArray([]);
    expect(fp).toBeTruthy();
    expect(fp).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprintBreaksArray([])).toBe(fp); // idempotent
  });

  it('T2.15b single break → same result across calls', () => {
    const br = mkBreak('x', 50, 100);
    const fp1 = fingerprintBreaksArray([br]);
    const fp2 = fingerprintBreaksArray([br]);
    expect(fp1).toBe(fp2);
    expect(fp1).not.toBe(fingerprintBreaksArray([]));
  });

  it('T2.15c reversed order produces same fingerprint (sorted by coordA)', () => {
    const b1 = mkBreak('x', 50, 100);
    const b2 = mkBreak('x', 200, 300);
    const fp_forward  = fingerprintBreaksArray([b1, b2]);
    const fp_reversed = fingerprintBreaksArray([b2, b1]);
    expect(fp_forward).toBe(fp_reversed);
  });

  it('T2.15d different coordA → different fingerprint', () => {
    const fp1 = fingerprintBreaksArray([mkBreak('x', 50, 100)]);
    const fp2 = fingerprintBreaksArray([mkBreak('x', 51, 100)]);
    expect(fp1).not.toBe(fp2);
  });

  it('T2.15e sub-1e-3 mm change in coordA → same fingerprint (1e-3 rounding bucket)', () => {
    const fp1 = fingerprintBreaksArray([mkBreak('x', 50.000, 100)]);
    const fp2 = fingerprintBreaksArray([mkBreak('x', 50.0001, 100)]);
    expect(fp1).toBe(fp2);
  });

  it('T2.15f different axis → different fingerprint', () => {
    const fp1 = fingerprintBreaksArray([mkBreak('x', 50, 100)]);
    const fp2 = fingerprintBreaksArray([mkBreak('y', 50, 100)]);
    expect(fp1).not.toBe(fp2);
  });
});

// ---------------------------------------------------------------------------
// T2.16 — §8.2 composition pattern
// ---------------------------------------------------------------------------

describe('fingerprintBreaksArray — §8.2 integration with inputFingerprint pattern (T2.16)', () => {
  it('T2.16a same view fingerprint + same breaks → same composed fingerprint', () => {
    const breaks: BreakRegion[] = [
      { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' },
    ];
    const fp1 = fingerprintBreaksArray(breaks);
    const fp2 = fingerprintBreaksArray(breaks);
    expect(fp1).toBe(fp2);
  });

  it('T2.16b different breaks array → different fingerprintBreaksArray output', () => {
    const b1: BreakRegion = { id: 'x', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };
    const b2: BreakRegion = { id: 'y', axis: 'x', coordA: 60, coordB: 100, gapMm: 5, style: 'zigzag' };
    expect(fingerprintBreaksArray([b1])).not.toBe(fingerprintBreaksArray([b2]));
  });
});
