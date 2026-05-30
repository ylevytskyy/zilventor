// packages/shared/src/drawing/__tests__/resolveCenterMarkGeometry.spec.ts
//
// Unit tests for resolveCenterMarkGeometry.
//
// THE KEY ROBUSTNESS TEST (Slice R-1):
//   Build near-collinear ~4° arc fragments of circle (7,3) r=5 with ±0.001mm
//   deterministic tessellation-style noise (each point independently perturbed
//   using sin/cos pseudo-randomness). For a 4° arc, D ≈ 0.002 so even 0.001mm
//   noise blows up circumcenterFromPolyline by >>1mm. Kasa over the 32 combined
//   points from 4 fragments covering 0°,35°,70°,110° positions recovers (7,3)
//   within 0.05mm — proving the fix is robust.

import { describe, it, expect } from 'vitest';
import { resolveCenterMarkGeometry, stripRunSuffix } from '../resolveCenterMarkGeometry';
import { circumcenterFromPolyline } from '../circumcenter';
import type { Edge2D } from '../projectedGeometry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** N equally-spaced points on arc from startDeg to endDeg (inclusive). */
function arcPoints(
  cx: number, cy: number, r: number,
  startDeg: number, endDeg: number, n: number,
): ReadonlyArray<readonly [number, number]> {
  return Array.from({ length: n }, (_, i) => {
    const θ = ((startDeg + (endDeg - startDeg) * (i / (n - 1))) * Math.PI) / 180;
    return [cx + r * Math.cos(θ), cy + r * Math.sin(θ)] as const;
  });
}

/**
 * Deterministic tessellation-like noise using sin/cos of seed.
 * Each point gets independent perturbation in [-amplitude, +amplitude].
 * (sin/cos are irrational periods → effectively pseudo-random for index series)
 */
function tessNoise(ptIndex: number, fragSeed: number, amplitude: number): [number, number] {
  const s = ptIndex + fragSeed;
  return [
    Math.sin(s * 7.391) * amplitude,
    Math.cos(s * 5.173) * amplitude,
  ];
}

/** N noisy arc points with deterministic ±amplitude noise. */
function noisyArcPoints(
  cx: number, cy: number, r: number,
  startDeg: number, endDeg: number, n: number,
  fragSeed: number,
  amplitude: number,
): ReadonlyArray<readonly [number, number]> {
  return Array.from({ length: n }, (_, i) => {
    const θ = ((startDeg + (endDeg - startDeg) * (i / (n - 1))) * Math.PI) / 180;
    const [nx, ny] = tessNoise(i, fragSeed, amplitude);
    return [cx + r * Math.cos(θ) + nx, cy + r * Math.sin(θ) + ny] as const;
  });
}

function fragmentEdge(
  id: string, cx: number, cy: number, r: number,
  startDeg: number, endDeg: number, n = 8,
): Edge2D {
  return { id, kind: 'feature', points: arcPoints(cx, cy, r, startDeg, endDeg, n) };
}

function noisyFragmentEdge(
  id: string, cx: number, cy: number, r: number,
  startDeg: number, endDeg: number, n: number,
  fragSeed: number, amplitude: number,
): Edge2D {
  return { id, kind: 'feature', points: noisyArcPoints(cx, cy, r, startDeg, endDeg, n, fragSeed, amplitude) };
}

// ---------------------------------------------------------------------------
// Slice R-1: near-collinear noisy fragments — THE robustness proof
// ---------------------------------------------------------------------------
describe('resolveCenterMarkGeometry', () => {
  it('R-1: noisy ~4° fragments of circle (7,3) r=5 → circumcenter blows up, Kasa over combined pts is accurate', () => {
    // Four fragments, each spanning only ~4° with ±0.001mm tessellation noise.
    // Fragments are at the 4 cardinal positions: 0°, 90°, 180°, 270°.
    // For a 4° arc of r=5, D ≈ 0.002; 0.001mm noise amplifies circumcenter
    // error by ~1000× → error >> 1mm. But Kasa over 32 pts at 4 well-separated
    // positions recovers the center accurately.
    const CX = 7, CY = 3, R = 5;
    const NOISE_MM = 0.001;

    // Fragments at 0°, 90°, 180°, 270° positions (spread around full circle).
    // Each fragment spans only 4° — genuinely near-collinear with noise → bad circumcenter.
    // Combined, the 4 positions give Kasa enough geometric leverage → good fit.
    const frags: Edge2D[] = [
      noisyFragmentEdge('rim_0',  CX, CY, R,   0,   4, 8,  0, NOISE_MM),
      noisyFragmentEdge('rim_9',  CX, CY, R,  90,  94, 8, 10, NOISE_MM),
      noisyFragmentEdge('rim_18', CX, CY, R, 180, 184, 8, 20, NOISE_MM),
      noisyFragmentEdge('rim_27', CX, CY, R, 270, 274, 8, 30, NOISE_MM),
    ];

    // Prove circumcenterFromPolyline on a single noisy 4° fragment is wildly off.
    const oldResult = circumcenterFromPolyline(frags[0]!.points);
    const oldDist = Math.hypot(oldResult.cx - CX, oldResult.cy - CY);
    expect(oldDist, 'circumcenter on single noisy 4° fragment should be >>1mm off').toBeGreaterThan(1.0);

    // New: resolveCenterMarkGeometry groups all rim_* (base='rim') together,
    // concatenates 32 noisy points, Kasa fit → robust (7,3).
    const geom = resolveCenterMarkGeometry(frags, 'rim_0');
    expect(geom).not.toBeNull();
    if (!geom) return;

    const dist = Math.hypot(geom.cx - CX, geom.cy - CY);
    expect(dist, 'Kasa fit should recover center within 0.05mm').toBeLessThan(0.05);
    expect(Math.abs(geom.r - R), 'Kasa fit should recover radius within 0.05mm').toBeLessThan(0.05);
  });

  // ---------------------------------------------------------------------------
  // Slice R-2: single non-fragmented full circle → correct center
  // ---------------------------------------------------------------------------
  it('R-2: single full-circle edge (32 pts, not fragmented) → correct center within 0.1mm', () => {
    const CX = -3, CY = 8, R = 4;
    const edge: Edge2D = fragmentEdge('circle_0', CX, CY, R, 0, 359.9, 32);
    const geom = resolveCenterMarkGeometry([edge], 'circle_0');
    expect(geom).not.toBeNull();
    const dist = Math.hypot(geom!.cx - CX, geom!.cy - CY);
    expect(dist).toBeLessThan(0.1);
  });

  // ---------------------------------------------------------------------------
  // Slice R-3: multiple run-suffixed fragments (same base id) → grouped
  // ---------------------------------------------------------------------------
  it('R-3: 4 fragments with _0/_9/_18/_27 suffixes → grouped under base → correct center', () => {
    const CX = 0, CY = 0, R = 5;
    const frags: Edge2D[] = [
      fragmentEdge('hole|rim|0_0',  CX, CY, R,   0,  30, 8),
      fragmentEdge('hole|rim|0_9',  CX, CY, R,  90, 120, 8),
      fragmentEdge('hole|rim|0_18', CX, CY, R, 180, 210, 8),
      fragmentEdge('hole|rim|0_27', CX, CY, R, 270, 300, 8),
    ];

    const geom = resolveCenterMarkGeometry(frags, 'hole|rim|0_0');
    expect(geom).not.toBeNull();
    const dist = Math.hypot(geom!.cx - CX, geom!.cy - CY);
    expect(dist).toBeLessThan(0.05);
  });

  // ---------------------------------------------------------------------------
  // Slice R-4: unknown edgeId → null
  // ---------------------------------------------------------------------------
  it('R-4: unknown edgeId → returns null', () => {
    const edge: Edge2D = fragmentEdge('known_edge', 0, 0, 5, 0, 360, 16);
    const geom = resolveCenterMarkGeometry([edge], 'does_not_exist');
    expect(geom).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Slice R-5: empty visibleEdges → null
  // ---------------------------------------------------------------------------
  it('R-5: empty visibleEdges → returns null', () => {
    expect(resolveCenterMarkGeometry([], 'any-id')).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Slice R-6: large arc (180°, 16 pts) → Kasa fit is accurate
  // ---------------------------------------------------------------------------
  it('R-6: single large-arc edge (180°, 16 pts) → correct center within 0.05mm', () => {
    const CX = 5, CY = 5, R = 3;
    const edge: Edge2D = fragmentEdge('large-arc', CX, CY, R, 0, 180, 16);
    const geom = resolveCenterMarkGeometry([edge], 'large-arc');
    expect(geom).not.toBeNull();
    const dist = Math.hypot(geom!.cx - CX, geom!.cy - CY);
    expect(dist).toBeLessThan(0.05);
  });

  // ---------------------------------------------------------------------------
  // Slice R-7: single 90° arc (falls through to circumcenter or Kasa — both OK)
  // ---------------------------------------------------------------------------
  it('R-7: single 90° arc (8 pts, no run suffix) → center within 0.1mm', () => {
    const CX = 2, CY = 4, R = 6;
    const edge: Edge2D = fragmentEdge('arc-q1', CX, CY, R, 0, 90, 8);
    const geom = resolveCenterMarkGeometry([edge], 'arc-q1');
    expect(geom).not.toBeNull();
    const dist = Math.hypot(geom!.cx - CX, geom!.cy - CY);
    expect(dist).toBeLessThan(0.1);
  });

  // ---------------------------------------------------------------------------
  // Slice R-8: stripRunSuffix — unit tests of the exported helper
  // ---------------------------------------------------------------------------
  describe('stripRunSuffix', () => {
    it('strips trailing _<int> suffix', () => {
      expect(stripRunSuffix('rim_17')).toBe('rim');
      expect(stripRunSuffix('hole|top|0_0')).toBe('hole|top|0');
      expect(stripRunSuffix('edge_35')).toBe('edge');
    });
    it('returns full id when no numeric suffix', () => {
      expect(stripRunSuffix('rim')).toBe('rim');
      expect(stripRunSuffix('a_run0')).toBe('a_run0'); // 'run0' is not purely numeric
      expect(stripRunSuffix('plain-arc')).toBe('plain-arc');
    });
  });
});
