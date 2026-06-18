import { describe, it, expect } from 'vitest';
import { buildGrooveCutter } from '../grooveMath';
import type { GrooveSpec } from '../groove';

const dims = { length: 600, width: 400, thickness: 18 };

describe('buildGrooveCutter — panel-local cutter box corners', () => {
  it('axis-u groove on Top face spans the full length (X), is width-wide across (Y), depth-deep (Z)', () => {
    const spec: GrooveSpec = { faceRole: 'Top', axis: 'u', position: 200, width: 6, depth: 9 };
    const { p1, p2 } = buildGrooveCutter(dims, spec);

    // X (run axis = length): full span -L/2 .. +L/2
    const xMin = Math.min(p1.x, p2.x), xMax = Math.max(p1.x, p2.x);
    expect(xMin).toBeCloseTo(-300, 6);
    expect(xMax).toBeCloseTo(300, 6);

    // Y (cross axis = width): width 6 centered at position 200 (→ y = -200 + 200 = 0)
    const yMin = Math.min(p1.y, p2.y), yMax = Math.max(p1.y, p2.y);
    expect(yMin).toBeCloseTo(-3, 6);
    expect(yMax).toBeCloseTo(3, 6);

    // Z (depth into face at z=T=18): from T down by depth (9) → 9 .. proud of face (>18)
    const zMin = Math.min(p1.z, p2.z), zMax = Math.max(p1.z, p2.z);
    expect(zMin).toBeCloseTo(9, 6);
    expect(zMax).toBeGreaterThan(18); // overcut: cutter pokes proud of the face for a clean boolean
  });

  it('axis-v groove on Top face spans the full width (Y), is width-wide across (X)', () => {
    const spec: GrooveSpec = { faceRole: 'Top', axis: 'v', position: 300, width: 6, depth: 9 };
    const { p1, p2 } = buildGrooveCutter(dims, spec);

    // Y (run axis = width): full span -W/2 .. +W/2
    const yMin = Math.min(p1.y, p2.y), yMax = Math.max(p1.y, p2.y);
    expect(yMin).toBeCloseTo(-200, 6);
    expect(yMax).toBeCloseTo(200, 6);

    // X (cross axis = length): width 6 centered at position 300 (→ x = -300 + 300 = 0)
    const xMin = Math.min(p1.x, p2.x), xMax = Math.max(p1.x, p2.x);
    expect(xMin).toBeCloseTo(-3, 6);
    expect(xMax).toBeCloseTo(3, 6);
  });

  it('axis-u groove on a Left side face runs along the panel thickness (Z) and cuts inward along -X', () => {
    // Left face: origin {-hL,-hW,0}, uDir +Z (thickness), vDir +Y (width), normal -X.
    const spec: GrooveSpec = { faceRole: 'Left', axis: 'u', position: 100, width: 4, depth: 5 };
    const { p1, p2 } = buildGrooveCutter(dims, spec);

    // run axis u = +Z (thickness 18): full span 0 .. T
    const zMin = Math.min(p1.z, p2.z), zMax = Math.max(p1.z, p2.z);
    expect(zMin).toBeCloseTo(0, 6);
    expect(zMax).toBeCloseTo(18, 6);

    // depth along -X (normal is -X): face at x=-300, cut inward → x goes toward -300+5 = -295,
    // proud side pokes to x < -300.
    const xMin = Math.min(p1.x, p2.x), xMax = Math.max(p1.x, p2.x);
    expect(xMax).toBeCloseTo(-295, 6); // 5mm into the panel from the -X face
    expect(xMin).toBeLessThan(-300);   // overcut proud of the face
  });
});
