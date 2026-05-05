// packages/shared/src/drawing/sectionPlane.test.ts
import { describe, it, expect } from 'vitest';
import { deriveSectionPlane } from './sectionPlane';
import type { Mat4 } from './viewMatrix';

// Front view: looking from +Y toward -Y; X→right, Z→up in view space
// In viewMatrix.ts, 'front' = identity (no rotation) after recentering.
// For testing we use identity (no translation) to keep math simple.
function frontViewMatrix(): Mat4 {
  // Row-major 4×4 identity
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ] as unknown as Mat4;
}

describe('deriveSectionPlane', () => {
  it('front view + horizontal section line → plane normal has zero X, non-zero Y or Z', () => {
    const { plane } = deriveSectionPlane(
      { p0: { x: 0, y: 50 }, p1: { x: 100, y: 50 } },
      frontViewMatrix(),
      1,
      1,
    );
    // With identity view matrix, view space == world space.
    // Section line is horizontal (dy=0), so 2D normal is (0, ±1) in view space,
    // which maps to (0, ±1, 0) in world space.
    expect(Math.abs(plane.normal.x)).toBeLessThan(1e-6);
    expect(Math.sqrt(plane.normal.y * plane.normal.y + plane.normal.z * plane.normal.z)).toBeGreaterThan(0.9);
  });

  it('front view + vertical section line → plane normal has non-zero X, zero Y/Z component', () => {
    const { plane } = deriveSectionPlane(
      { p0: { x: 50, y: 0 }, p1: { x: 50, y: 100 } },
      frontViewMatrix(),
      1,
      1,
    );
    // Section line is vertical (dx=0), so 2D normal is (±1, 0) in view space,
    // which maps to (±1, 0, 0) in world space with identity matrix.
    expect(Math.abs(plane.normal.x)).toBeGreaterThan(0.9);
    expect(Math.abs(plane.normal.y)).toBeLessThan(1e-6);
    expect(Math.abs(plane.normal.z)).toBeLessThan(1e-6);
  });

  it('arrowDirection = -1 → plane normal negated vs arrowDirection = +1', () => {
    const { plane: p1 } = deriveSectionPlane(
      { p0: { x: 0, y: 50 }, p1: { x: 100, y: 50 } },
      frontViewMatrix(),
      1,
      1,
    );
    const { plane: p2 } = deriveSectionPlane(
      { p0: { x: 0, y: 50 }, p1: { x: 100, y: 50 } },
      frontViewMatrix(),
      1,
      -1,
    );
    expect(p1.normal.x).toBeCloseTo(-p2.normal.x, 6);
    expect(p1.normal.y).toBeCloseTo(-p2.normal.y, 6);
    expect(p1.normal.z).toBeCloseTo(-p2.normal.z, 6);
  });

  it('scale factor scales origin correctly', () => {
    const { plane: p1 } = deriveSectionPlane(
      { p0: { x: 0, y: 50 }, p1: { x: 100, y: 50 } },
      frontViewMatrix(),
      1,
      1,
    );
    const { plane: p2 } = deriveSectionPlane(
      { p0: { x: 0, y: 100 }, p1: { x: 200, y: 100 } },
      frontViewMatrix(),
      2,     // scale 2 → view coords / 2 = same world coords as above
      1,
    );
    expect(p1.origin.x).toBeCloseTo(p2.origin.x, 3);
    expect(p1.origin.y).toBeCloseTo(p2.origin.y, 3);
    expect(p1.origin.z).toBeCloseTo(p2.origin.z, 3);
  });

  it('sectionViewMatrix is orthonormal (det ≈ ±1)', () => {
    const { sectionViewMatrix } = deriveSectionPlane(
      { p0: { x: 0, y: 50 }, p1: { x: 100, y: 50 } },
      frontViewMatrix(),
      1,
      1,
    );
    const m = sectionViewMatrix as unknown as number[];
    // Extract upper-left 3×3 (row-major) and compute determinant
    // Row 0: m[0], m[1], m[2]
    // Row 1: m[4], m[5], m[6]
    // Row 2: m[8], m[9], m[10]
    const det =
      m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) -
      m[1]! * (m[4]! * m[10]! - m[8]! * m[6]!) +
      m[2]! * (m[4]! * m[9]! - m[8]! * m[5]!);
    expect(Math.abs(Math.abs(det) - 1)).toBeLessThan(1e-4);
  });
});
