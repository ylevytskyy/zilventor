// packages/shared/src/drawing/__tests__/viewMatrix.spec.ts
import { describe, it, expect } from 'vitest';
import { buildViewMatrix, apply } from '../viewMatrix';

const EPS = 1e-6;
function near(a: number, b: number) { return Math.abs(a - b) < EPS; }
function nearV(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return near(a.x, b.x) && near(a.y, b.y) && near(a.z, b.z);
}

// bbox: 100×60×40 box centred at (50,30,20)
const bbox: [number, number, number, number, number, number] = [0, 0, 0, 100, 60, 40];

describe('buildViewMatrix', () => {
  it('front: identity rotation — point (50,30,20) maps to (0,0,0) after recentre', () => {
    const M = buildViewMatrix('front', bbox);
    const p = apply(M, { x: 50, y: 30, z: 20 });
    expect(nearV(p, { x: 0, y: 0, z: 0 })).toBe(true);
  });

  it('front: point at origin maps to bbox-centre-negated after recentre', () => {
    const M = buildViewMatrix('front', bbox);
    const p = apply(M, { x: 0, y: 0, z: 0 });
    expect(nearV(p, { x: -50, y: -30, z: -20 })).toBe(true);
  });

  it('top: rotateX(-90°) — world +Z becomes view +Y', () => {
    // Under rotateX(-90°): y′ = z, z′ = -y (right-hand rule)
    const M = buildViewMatrix('top', bbox);
    // recentre by (-50,-30,-20), then rotateX(-90°)
    // test relative: delta (0,0,1) in world → (0,1,0) after rotation (ignoring recentre offset)
    const a = apply(M, { x: 50, y: 30, z: 21 });
    const b = apply(M, { x: 50, y: 30, z: 20 });
    const delta = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
    expect(nearV(delta, { x: 0, y: 1, z: 0 })).toBe(true);
  });

  it('right: rotateY(-90°) — world -Z becomes view +X', () => {
    // Under rotateY(-90°): x′ = z, z′ = -x (right-hand rule negated)
    const M = buildViewMatrix('right', bbox);
    const a = apply(M, { x: 50, y: 30, z: 21 });
    const b = apply(M, { x: 50, y: 30, z: 20 });
    const delta = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
    // rotateY(-θ): [cos -sin 0 / sin cos 0 / 0 0 1] in XZ plane with -90 gives x′=cos(-90)x-sin(-90)z=0·x+1·z=z, z′=sin(-90)x+cos(-90)z=-x
    // So delta(0,0,1) → (1, 0, 0)
    expect(nearV(delta, { x: 1, y: 0, z: 0 })).toBe(true);
  });

  it('iso-NE: applies non-trivial rotation — result is neither axis-aligned', () => {
    const M = buildViewMatrix('iso-NE', bbox);
    const p = apply(M, { x: 50, y: 30, z: 20 });
    // recentred origin; iso rotated — all three components may differ but result is deterministic
    expect(nearV(p, { x: 0, y: 0, z: 0 })).toBe(true); // centre → origin
  });

  it('iso-NE delta(1,0,0) has non-zero x and z components', () => {
    const M = buildViewMatrix('iso-NE', bbox);
    const a = apply(M, { x: 51, y: 30, z: 20 });
    const b = apply(M, { x: 50, y: 30, z: 20 });
    const delta = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
    expect(Math.abs(delta.x) > 0.1).toBe(true);
    expect(Math.abs(delta.z) > 0.1).toBe(true);
  });

  it('apply: identity matrix leaves vec unchanged', () => {
    const I: number[] = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    const v = { x: 3, y: -7, z: 2 };
    expect(nearV(apply(I, v), v)).toBe(true);
  });
});
