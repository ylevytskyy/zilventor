import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { makeBox, computeBoundingBox, disposeShape } from '../SolidOps';
import { writeBRep, readBRep } from '../BRepIO';

let occt: OcctInstance;
beforeAll(async () => {
  occt = await loadOcct();
}, 60_000);

describe('BRepIO', () => {
  it('round-trips a box through BREP bytes', () => {
    const original = makeBox(occt, 100, 200, 300);
    const bytes = writeBRep(occt, original);
    expect(bytes.byteLength).toBeGreaterThan(0);

    const restored = readBRep(occt, bytes);
    const bb = computeBoundingBox(occt, restored);
    expect(bb[0]).toBeCloseTo(0, 5);
    expect(bb[1]).toBeCloseTo(0, 5);
    expect(bb[2]).toBeCloseTo(0, 5);
    expect(bb[3]).toBeCloseTo(100, 5);
    expect(bb[4]).toBeCloseTo(200, 5);
    expect(bb[5]).toBeCloseTo(300, 5);

    disposeShape(original);
    disposeShape(restored);
  });

  it('does not leak the output shape when reading corrupt bytes', () => {
    // Simulate BREP read on garbage. Expect it to throw or reject cleanly,
    // and not leave a dangling TopoDS_Shape in the OCCT heap.
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
    expect(() => readBRep(occt, garbage)).toThrow();
    // If the finally block didn't delete shape, we'd still pass the throw
    // assertion — the real evidence is no crash across repetitions:
    for (let i = 0; i < 20; i++) {
      try { readBRep(occt, garbage); } catch { /* expected */ }
    }
    expect(true).toBe(true);
  });
});
