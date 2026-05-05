// packages/shared/src/drawing/depthBuffer.ts
import type { BoundingBox } from '../types';

/** Returns the adaptive pixel pitch in mm: max(0.25, bbox_diag / 2048). */
export function adaptivePixelPitch(bbox: BoundingBox): number {
  const [minX, minY, minZ, maxX, maxY, maxZ] = bbox;
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  const diag = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return Math.max(0.25, diag / 2048);
}

type Tri3 = [[number, number, number], [number, number, number], [number, number, number]];

/**
 * Rasterise triangles (already in view space) into a Z-buffer.
 * Buffer is indexed as buf[row * stride + col] where row↑ = +Y, col→ = +X.
 * Initialised to Infinity (nothing in front).
 *
 * @param triangles  Array of [v0, v1, v2] each [x, y, z] in view space.
 * @param bbox       View-space bounding box of the visible geometry.
 * @param pixelPitchMm  mm per pixel (use adaptivePixelPitch).
 */
export function buildDepthBuffer(
  triangles: ReadonlyArray<Tri3>,
  bbox: BoundingBox,
  pixelPitchMm: number,
): Float32Array {
  const [minX, minY, , maxX, maxY] = bbox;
  const cols = Math.ceil((maxX - minX) / pixelPitchMm) + 1;
  const rows = Math.ceil((maxY - minY) / pixelPitchMm) + 1;
  const buf = new Float32Array(cols * rows).fill(Infinity);

  for (const tri of triangles) {
    rasteriseTri(tri, buf, cols, rows, minX, minY, pixelPitchMm);
  }
  return buf;
}

function rasteriseTri(
  tri: Tri3,
  buf: Float32Array,
  stride: number,
  numRows: number,
  originX: number,
  originY: number,
  pitch: number,
): void {
  const [v0, v1, v2] = tri;
  const [x0, y0, z0] = v0;
  const [x1, y1, z1] = v1;
  const [x2, y2, z2] = v2;

  // Edge-function area; skip degenerate (zero-area) triangles
  const area2 = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(area2) < 1e-10) return;

  // Pixel bounding box of the triangle
  const xMin = Math.min(x0, x1, x2);
  const xMax = Math.max(x0, x1, x2);
  const yMin = Math.min(y0, y1, y2);
  const yMax = Math.max(y0, y1, y2);

  const colMin = Math.max(0, Math.floor((xMin - originX) / pitch));
  const colMax = Math.min(stride - 1, Math.ceil((xMax - originX) / pitch));
  const rowMin = Math.max(0, Math.floor((yMin - originY) / pitch));
  const rowMax = Math.min(numRows - 1, Math.ceil((yMax - originY) / pitch));

  for (let row = rowMin; row <= rowMax; row++) {
    for (let col = colMin; col <= colMax; col++) {
      const px = originX + col * pitch;
      const py = originY + row * pitch;

      // Edge functions in standard [v1→v2, v2→v0, v0→v1] order.
      // With this convention, w0(v0)=area2, w1(v1)=area2, w2(v2)=area2, so
      // b0=w0/area2 is the barycentric weight for v0 (and likewise b1↔v1, b2↔v2).
      const w0 = (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1);
      const w1 = (x0 - x2) * (py - y2) - (px - x2) * (y0 - y2);
      const w2 = (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0);

      // Point inside (or on edge of) triangle when all weights have the same sign as area2
      const inside =
        area2 > 0
          ? w0 >= 0 && w1 >= 0 && w2 >= 0
          : w0 <= 0 && w1 <= 0 && w2 <= 0;

      if (!inside) continue;

      // Barycentric interpolation for Z: b0↔v0, b1↔v1, b2↔v2
      const b0 = w0 / area2;
      const b1 = w1 / area2;
      const b2 = 1 - b0 - b1;
      const z = b0 * z0 + b1 * z1 + b2 * z2;

      const idx = row * stride + col;
      const cur = buf[idx];
      if (cur !== undefined && z < cur) buf[idx] = z;
    }
  }
}
