import { describe, it, expect, vi } from 'vitest';
import { computeDownscaleSize, downscaleToJpeg } from '../downscaleTexture';

describe('computeDownscaleSize', () => {
  it('caps the longest edge at 1024, preserving aspect (landscape)', () => {
    expect(computeDownscaleSize(2048, 1024)).toEqual({ width: 1024, height: 512 });
  });
  it('caps the longest edge at 1024 (portrait)', () => {
    expect(computeDownscaleSize(800, 1600)).toEqual({ width: 512, height: 1024 });
  });
  it('leaves images already within 1024 untouched', () => {
    expect(computeDownscaleSize(640, 480)).toEqual({ width: 640, height: 480 });
  });
  it('rounds to integer pixels', () => {
    expect(computeDownscaleSize(1025, 1025)).toEqual({ width: 1024, height: 1024 });
  });
});

describe('downscaleToJpeg', () => {
  it('draws at the capped size and encodes JPEG q0.9', async () => {
    const drawImage = vi.fn();
    const toBlob = vi.fn((cb: (b: Blob) => void, type: string, q: number) => {
      expect(type).toBe('image/jpeg');
      expect(q).toBeCloseTo(0.9);
      cb(new Blob([new Uint8Array([1, 2, 3])], { type }));
    });
    const fakeCtx = { drawImage };
    const fakeCanvas = { getContext: () => fakeCtx, toBlob, width: 0, height: 0 } as unknown as HTMLCanvasElement;
    const bytes = await downscaleToJpeg(
      { width: 2048, height: 1024 } as unknown as CanvasImageSource & { width: number; height: number },
      () => fakeCanvas,
    );
    expect(fakeCanvas.width).toBe(1024);
    expect(fakeCanvas.height).toBe(512);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1024, 512);
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });
});
