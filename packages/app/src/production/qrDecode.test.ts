import { describe, it, expect } from 'vitest';
import { qrMatrix } from '../drawing/qr';
import { decodeQrFromImageData } from './qrDecode';

/** Rasterize a QrMatrix into an RGBA Uint8ClampedArray at `scale` px/module,
 * padded with `quietModules` modules of white margin on every side (jsQR/most
 * decoders need a quiet zone to reliably locate finder patterns). */
function rasterize(
  matrix: { size: number; data: Uint8Array },
  scale: number,
  quietModules: number
): { data: Uint8ClampedArray; width: number; height: number } {
  const modulesPerSide = matrix.size + quietModules * 2;
  const width = modulesPerSide * scale;
  const height = width;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let r = 0; r < matrix.size; r++) {
    for (let c = 0; c < matrix.size; c++) {
      if (matrix.data[r * matrix.size + c] !== 1) continue;
      const px0 = (c + quietModules) * scale;
      const py0 = (r + quietModules) * scale;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const idx = ((py0 + dy) * width + (px0 + dx)) * 4;
          data[idx] = 0;
          data[idx + 1] = 0;
          data[idx + 2] = 0;
          data[idx + 3] = 255;
        }
      }
    }
  }
  return { data, width, height };
}

describe('decodeQrFromImageData', () => {
  it('round-trips a payload encoded via qrMatrix', () => {
    const payload = 'ZILV:panel:abc-123';
    const matrix = qrMatrix(payload);
    const { data, width, height } = rasterize(matrix, 4, 4);
    expect(decodeQrFromImageData(data, width, height)).toBe(payload);
  });

  it('returns null when no QR code is present', () => {
    const width = 64;
    const height = 64;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    expect(decodeQrFromImageData(data, width, height)).toBeNull();
  });
});
