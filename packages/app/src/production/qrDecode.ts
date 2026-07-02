import jsQR from 'jsqr';

/** Decode a QR payload string from raw RGBA image data, or null if none found. */
export function decodeQrFromImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number
): string | null {
  const result = jsQR(data, width, height);
  return result ? result.data : null;
}
