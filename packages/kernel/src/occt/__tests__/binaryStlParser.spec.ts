import { describe, it, expect } from 'vitest';
import { parseBinaryStl } from './binaryStlParser';

/** Hand-build a binary STL with `tris` triangles (each vertex list is [v0,v1,v2], each v = [x,y,z]). */
function buildBinaryStl(tris: Array<[[number, number, number], [number, number, number], [number, number, number]]>): Uint8Array {
  const bytes = new Uint8Array(84 + tris.length * 50);
  const dv = new DataView(bytes.buffer);
  // 80-byte header left as zeros, then triangle count at offset 80.
  dv.setUint32(80, tris.length, true);
  let off = 84;
  for (const [v0, v1, v2] of tris) {
    // normal (3 × f32) left zero
    off += 12;
    for (const v of [v0, v1, v2]) {
      dv.setFloat32(off, v[0], true);
      dv.setFloat32(off + 4, v[1], true);
      dv.setFloat32(off + 8, v[2], true);
      off += 12;
    }
    off += 2; // uint16 attribute byte count
  }
  return bytes;
}

describe('parseBinaryStl', () => {
  it('reads triangle count and accumulates a bbox over all vertices', () => {
    const bytes = buildBinaryStl([
      [[0, 0, 0], [10, 0, 0], [0, 5, 0]],
      [[2, 2, 2], [-3, 4, 1], [1, 1, 7]],
    ]);
    const { triCount, bbox } = parseBinaryStl(bytes);
    expect(triCount).toBe(2);
    // bbox = [minX,minY,minZ,maxX,maxY,maxZ]
    expect(bbox[0]).toBeCloseTo(-3, 5);
    expect(bbox[1]).toBeCloseTo(0, 5);
    expect(bbox[2]).toBeCloseTo(0, 5);
    expect(bbox[3]).toBeCloseTo(10, 5);
    expect(bbox[4]).toBeCloseTo(5, 5);
    expect(bbox[5]).toBeCloseTo(7, 5);
  });

  it('handles a non-zero byteOffset Uint8Array view (slice of a larger buffer)', () => {
    const inner = buildBinaryStl([[[0, 0, 0], [1, 0, 0], [0, 1, 0]]]);
    const padded = new Uint8Array(inner.length + 16);
    padded.set(inner, 16);
    const view = padded.subarray(16); // byteOffset === 16, non-trivial
    const { triCount, bbox } = parseBinaryStl(view);
    expect(triCount).toBe(1);
    expect(bbox[3]).toBeCloseTo(1, 5);
    expect(bbox[4]).toBeCloseTo(1, 5);
  });

  it('returns facetVertices with per-triangle vertex triples', () => {
    const bytes = buildBinaryStl([
      [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
    ]);
    const { triCount, facetVertices } = parseBinaryStl(bytes);
    expect(triCount).toBe(1);
    expect(facetVertices).toHaveLength(1);
    const tri0 = facetVertices[0]!;
    const [v0, v1, v2] = tri0;
    expect(v0[0]).toBeCloseTo(1, 5);
    expect(v1[1]).toBeCloseTo(5, 5);
    expect(v2[2]).toBeCloseTo(9, 5);
  });
});
