/**
 * Test-only binary-STL parser. Reads the 80-byte header + uint32 triangle
 * count, then walks each 50-byte triangle record (12-byte normal, 3×12-byte
 * vertices, 2-byte attribute) accumulating an axis-aligned bbox over every
 * vertex. Returns { triCount, bbox=[minX,minY,minZ,maxX,maxY,maxZ],
 * facetVertices } where facetVertices[i] = [v0,v1,v2] (each v = [x,y,z]).
 *
 * DataView is constructed over (buffer, byteOffset, byteLength) so a Uint8Array
 * that is a non-zero-offset view of a larger ArrayBuffer parses correctly.
 */
export type FacetTriangle = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

export function parseBinaryStl(
  bytes: Uint8Array,
): {
  triCount: number;
  bbox: [number, number, number, number, number, number];
  facetVertices: FacetTriangle[];
} {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triCount = dv.getUint32(80, true); // little-endian, after the 80-byte header
  let off = 84;
  const b: [number, number, number, number, number, number] = [
    Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity,
  ];
  const facetVertices: FacetTriangle[] = [];
  for (let t = 0; t < triCount; t++) {
    off += 12; // skip the per-facet normal (3 × float32)
    const verts: Array<[number, number, number]> = [];
    for (let v = 0; v < 3; v++) {
      const x = dv.getFloat32(off, true);
      const y = dv.getFloat32(off + 4, true);
      const z = dv.getFloat32(off + 8, true);
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (z < b[2]) b[2] = z;
      if (x > b[3]) b[3] = x;
      if (y > b[4]) b[4] = y;
      if (z > b[5]) b[5] = z;
      verts.push([x, y, z]);
      off += 12;
    }
    facetVertices.push(verts as FacetTriangle);
    off += 2; // uint16 attribute byte count
  }
  return { triCount, bbox: b, facetVertices };
}
