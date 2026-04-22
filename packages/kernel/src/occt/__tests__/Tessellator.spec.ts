import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { makeBox, disposeShape } from '../SolidOps';
import { tessellate } from '../Tessellator';

let occt: OcctInstance;
beforeAll(async () => {
  occt = await loadOcct();
}, 60_000);

describe('Tessellator', () => {
  it('produces triangles for a box and all are within bounds', () => {
    const box = makeBox(occt, 100, 200, 300);
    const mesh = tessellate(occt, box, { linearDeflection: 0.1 });
    expect(mesh.positions.byteLength).toBeGreaterThan(0);
    expect(mesh.indices.length % 3).toBe(0);
    expect(mesh.indices.length).toBeGreaterThanOrEqual(36);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i]!;
      const y = mesh.positions[i + 1]!;
      const z = mesh.positions[i + 2]!;
      expect(x).toBeGreaterThanOrEqual(-1e-3);
      expect(x).toBeLessThanOrEqual(100 + 1e-3);
      expect(y).toBeGreaterThanOrEqual(-1e-3);
      expect(y).toBeLessThanOrEqual(200 + 1e-3);
      expect(z).toBeGreaterThanOrEqual(-1e-3);
      expect(z).toBeLessThanOrEqual(300 + 1e-3);
    }
    disposeShape(box);
  });
});
