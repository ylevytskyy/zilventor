// packages/shared/src/drawing/__tests__/isArcEdge.spec.ts
import { describe, it, expect } from 'vitest';
import { isArcEdge } from '../isArcEdge';

// ---------------------------------------------------------------------------
// Helper: generate N equally-spaced points on circle (cx, cy, r)
// ---------------------------------------------------------------------------
function circlePoints(
  cx: number,
  cy: number,
  r: number,
  n: number,
): ReadonlyArray<readonly [number, number]> {
  return Array.from({ length: n }, (_, i) => {
    const θ = (2 * Math.PI * i) / n;
    return [cx + r * Math.cos(θ), cy + r * Math.sin(θ)] as const;
  });
}

describe('isArcEdge', () => {
  it('returns true for a 16-point polyline sampled on a circle r=10mm', () => {
    const pts = circlePoints(0, 0, 10, 16);
    expect(isArcEdge(pts)).toBe(true);
  });

  it('returns false for a 2-point straight edge (below minPoints threshold)', () => {
    const pts: ReadonlyArray<readonly [number, number]> = [[0, 0], [10, 0]];
    expect(isArcEdge(pts)).toBe(false);
  });

  it('returns false for a 4-point near-straight edge (below minPoints threshold)', () => {
    const pts: ReadonlyArray<readonly [number, number]> = [[0, 0], [3, 0.01], [6, 0], [9, 0]];
    expect(isArcEdge(pts)).toBe(false);
  });

  it('returns false for a tiny-radius arc (r < 0.5mm)', () => {
    // r=0.1mm — below minRadiusMm=0.5 threshold
    const pts = circlePoints(0, 0, 0.1, 16);
    expect(isArcEdge(pts)).toBe(false);
  });

  it('returns true for a partial arc (half-circle, 8 points, r=5mm)', () => {
    // Arc from 0 to PI on radius 5
    const pts = Array.from({ length: 8 }, (_, i) => {
      const θ = (Math.PI * i) / 7;
      return [5 * Math.cos(θ), 5 * Math.sin(θ)] as const;
    }) as ReadonlyArray<readonly [number, number]>;
    expect(isArcEdge(pts)).toBe(true);
  });

  it('returns false for a zigzag polyline that is not circular', () => {
    // Zigzag: clearly not a circle
    const pts: ReadonlyArray<readonly [number, number]> = [
      [0, 0], [1, 5], [2, 0], [3, 5], [4, 0], [5, 5],
    ];
    expect(isArcEdge(pts)).toBe(false);
  });
});
