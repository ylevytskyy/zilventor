import { describe, it, expect } from 'vitest';
import { dot, cross, sub, add, scale, normalize, length } from '../WorkFeatureOps';
import type { Vec3 } from '@zilventor/shared';

describe('Vec3 helpers', () => {
  it('dot product', () => {
    expect(dot({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })).toBe(32);
  });

  it('cross product', () => {
    expect(cross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('cross product is anti-commutative', () => {
    const a: Vec3 = { x: 1, y: 2, z: 3 };
    const b: Vec3 = { x: 4, y: 5, z: 6 };
    const ab = cross(a, b);
    const ba = cross(b, a);
    expect(ab).toEqual({ x: -ba.x, y: -ba.y, z: -ba.z });
  });

  it('subtract', () => {
    expect(sub({ x: 5, y: 5, z: 5 }, { x: 1, y: 2, z: 3 })).toEqual({ x: 4, y: 3, z: 2 });
  });

  it('add', () => {
    expect(add({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })).toEqual({ x: 5, y: 7, z: 9 });
  });

  it('scale', () => {
    expect(scale({ x: 1, y: 2, z: 3 }, 2)).toEqual({ x: 2, y: 4, z: 6 });
  });

  it('normalize unit vector', () => {
    const n = normalize({ x: 3, y: 0, z: 0 });
    expect(n.x).toBeCloseTo(1, 5);
    expect(n.y).toBeCloseTo(0, 5);
    expect(n.z).toBeCloseTo(0, 5);
  });

  it('normalize returns zero for near-zero input', () => {
    const n = normalize({ x: 0, y: 0, z: 0 });
    expect(n).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('length', () => {
    expect(length({ x: 3, y: 4, z: 0 })).toBeCloseTo(5, 5);
  });
});
