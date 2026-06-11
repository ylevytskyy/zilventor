import { describe, it, expect } from 'vitest';
import { signedDragDeltaAlongAxis, GIZMO_AXIS_VIEW_PARALLEL_THRESHOLD } from '../dragProjection';

// Camera looking straight down -Z from z=100. A pointer ray is vertical (dir = (0,0,-1)),
// its origin's XY is where the pointer "is" in world space. Moving the pointer in +X by 5mm
// must yield delta = +5 along world-X axis. Oracle authored from geometry, not the impl.
const downZ = (x: number, y: number) => ({ origin: { x, y, z: 100 }, dir: { x: 0, y: 0, z: -1 } });

describe('signedDragDeltaAlongAxis', () => {
  it('maps a +X pointer move to +5 along world-X', () => {
    const axis = { x: 1, y: 0, z: 0 };
    const pivot = { x: 0, y: 0, z: 0 };
    const d = signedDragDeltaAlongAxis(axis, pivot, downZ(0, 0), downZ(5, 0));
    expect(d).toBeCloseTo(5, 6);
  });

  it('ignores pointer motion orthogonal to the axis', () => {
    const axis = { x: 1, y: 0, z: 0 };
    const pivot = { x: 0, y: 0, z: 0 };
    const d = signedDragDeltaAlongAxis(axis, pivot, downZ(0, 0), downZ(0, 7));
    expect(d).toBeCloseTo(0, 6);
  });

  it('is signed (negative drag)', () => {
    const axis = { x: 1, y: 0, z: 0 };
    const d = signedDragDeltaAlongAxis(axis, { x: 0, y: 0, z: 0 }, downZ(3, 0), downZ(-2, 0));
    expect(d).toBeCloseTo(-5, 6);
  });

  it('works for a vertical (world-Z) axis with a side-on camera', () => {
    // Camera looking down -Y; pointer ray dir = (0,-1,0); moving origin +Z by 4 → +4 along world-Z.
    const ray = (z: number) => ({ origin: { x: 0, y: 100, z }, dir: { x: 0, y: -1, z: 0 } });
    const d = signedDragDeltaAlongAxis({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }, ray(0), ray(4));
    expect(d).toBeCloseTo(4, 6);
  });

  it('returns null when the axis is near-parallel to the view (degenerate)', () => {
    // axis = world-Z, ray dir also ~ -Z → |axis·dir| ≈ 1 > threshold → return null (PC4).
    const ray = (x: number) => ({ origin: { x, y: 0, z: 100 }, dir: { x: 0, y: 0, z: -1 } });
    const d = signedDragDeltaAlongAxis({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }, ray(0), ray(5));
    expect(d).toBeNull();
  });

  it('threshold constant is 0.95', () => {
    expect(GIZMO_AXIS_VIEW_PARALLEL_THRESHOLD).toBeCloseTo(0.95, 6);
  });
});
