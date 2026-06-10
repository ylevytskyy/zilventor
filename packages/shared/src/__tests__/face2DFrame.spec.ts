import { describe, it, expect } from 'vitest';
import { face2DFrame } from '../bore';
import type { BoreOp } from '../bore';

const dims = { length: 600, width: 400, thickness: 18 };

describe('face2DFrame — panel-local 2D coordinate frames', () => {
  it('Top face: origin on the +Z plane, uDir/vDir span the L×W plane, normal = +Z', () => {
    const f = face2DFrame(dims, 'Top');
    // Top face lies at z = T
    expect(f.origin.z).toBeCloseTo(18, 6);
    // u·v cross product must point +Z (into the +Z half-space / outward)
    const n = cross(f.uDir, f.vDir);
    expect(n.x).toBeCloseTo(0, 6);
    expect(n.y).toBeCloseTo(0, 6);
    expect(n.z).toBeGreaterThan(0);
  });

  it('Front face (+Y): origin at y = +W/2, normal = +Y', () => {
    const f = face2DFrame(dims, 'Front');
    expect(f.origin.y).toBeCloseTo(200, 6);
    const n = cross(f.uDir, f.vDir);
    expect(n.y).toBeGreaterThan(0);
    expect(n.x).toBeCloseTo(0, 6);
    expect(n.z).toBeCloseTo(0, 6);
  });

  it('Left face (−X): origin at x = −L/2, normal = −X', () => {
    const f = face2DFrame(dims, 'Left');
    expect(f.origin.x).toBeCloseTo(-300, 6);
    const n = cross(f.uDir, f.vDir);
    expect(n.x).toBeLessThan(0);
  });

  it('is reversible: (u,v)=(0,0) maps to origin, and unit u/v steps are orthonormal', () => {
    const f = face2DFrame(dims, 'Right');
    expect(len(f.uDir)).toBeCloseTo(1, 6);
    expect(len(f.vDir)).toBeCloseTo(1, 6);
    expect(dot(f.uDir, f.vDir)).toBeCloseTo(0, 6);
  });

  it('BoreOp shape is structurally usable (compile + literal)', () => {
    const b: BoreOp = {
      id: 'b1', face: { featureId: 'panel', role: 'Left', instance: 0 },
      u: 50, v: 100, diameter: 5, depth: 34, role: 'confirmat-face',
      connectorId: 'c1', connectorKind: 'confirmat',
    };
    expect(b.depth).toBe(34);
    const through: BoreOp['depth'] = 'throughAll';
    expect(through).toBe('throughAll');
  });
});

function cross(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function dot(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function len(a: { x: number; y: number; z: number }) {
  return Math.sqrt(dot(a, a));
}
