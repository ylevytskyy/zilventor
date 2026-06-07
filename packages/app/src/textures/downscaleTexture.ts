const MAX_EDGE = 1024;
const JPEG_QUALITY = 0.9;

export function computeDownscaleSize(w: number, h: number): { width: number; height: number } {
  const longest = Math.max(w, h);
  if (longest <= MAX_EDGE) return { width: Math.round(w), height: Math.round(h) };
  const scale = MAX_EDGE / longest;
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

export type DrawableSource = CanvasImageSource & { width: number; height: number };

/** Downscale a decoded image source to ≤1024px longest edge and re-encode as JPEG q0.9.
 *  `canvasFactory` defaults to a real <canvas>; injectable for tests. */
export async function downscaleToJpeg(
  src: DrawableSource,
  canvasFactory: () => HTMLCanvasElement = () => document.createElement('canvas'),
): Promise<Uint8Array> {
  const { width, height } = computeDownscaleSize(src.width, src.height);
  const canvas = canvasFactory();
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('downscaleToJpeg: 2D canvas context unavailable');
  ctx.drawImage(src, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', JPEG_QUALITY),
  );
  if (!blob) throw new Error('downscaleToJpeg: toBlob produced no blob');
  // `blob.arrayBuffer()` is absent in jsdom; fall back to FileReader for compat.
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob!);
  });
}

/** Decode a File into a drawable bitmap (browser path used by the upload dialog). */
export async function decodeImageFile(file: File): Promise<DrawableSource> {
  const bitmap = await createImageBitmap(file);
  return bitmap as unknown as DrawableSource;
}
