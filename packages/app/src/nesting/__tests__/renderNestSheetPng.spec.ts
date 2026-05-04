import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Builds a minimal valid PNG Uint8Array with the given width and height encoded
 * in the IHDR chunk (bytes 16–19 = width big-endian, 20–23 = height big-endian).
 * The body of the PNG (IDAT, IEND) is omitted for brevity — we only test the header.
 */
function makeFakePng(width: number, height: number): Uint8Array {
  // PNG signature (8 bytes) + IHDR chunk length (4 bytes) + "IHDR" (4 bytes) + width (4 bytes) + height (4 bytes)
  const buf = new Uint8Array(24);
  const view = new DataView(buf.buffer);
  // PNG signature
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47;
  buf[4] = 0x0d; buf[5] = 0x0a; buf[6] = 0x1a; buf[7] = 0x0a;
  // IHDR chunk length = 13
  view.setUint32(8, 13, false);
  // "IHDR"
  buf[12] = 0x49; buf[13] = 0x48; buf[14] = 0x44; buf[15] = 0x52;
  // Width
  view.setUint32(16, width, false);
  // Height
  view.setUint32(20, height, false);
  return buf;
}

// Mock OffscreenCanvas so we can test the OffscreenCanvas path in jsdom.
// We capture the width/height from the constructor and return a fake PNG blob
// with the correct IHDR dimensions via convertToBlob.
let offscreenWidth = 0;
let offscreenHeight = 0;

const mockCtx = {
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  font: '',
  textBaseline: 'top',
  textAlign: 'start',
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  fillText: vi.fn(),
};

class MockOffscreenCanvas {
  constructor(width: number, height: number) {
    offscreenWidth = width;
    offscreenHeight = height;
  }
  getContext(_type: string) {
    return mockCtx;
  }
  convertToBlob(_opts?: { type?: string }): Promise<Blob> {
    const bytes = makeFakePng(offscreenWidth, offscreenHeight);
    return Promise.resolve(new Blob([bytes], { type: 'image/png' }));
  }
}

describe('renderNestSheetPng', () => {
  const sheet = {
    materialId: 'm1',
    sheetIndex: 1,
    sheetLengthMm: 2440,
    sheetWidthMm: 1220,
    utilizationPct: 50.0,
    panels: [{ itemNumber: 1, rowKey: 'r1', x: 0, y: 0, length: 600, width: 400, rotated: false }],
  } as const;
  const materials = [
    {
      id: 'm1',
      name: 'Birch',
      defaultThickness: 18,
      color: '#aabbcc',
      sheetLengthMm: 2440,
      sheetWidthMm: 1220,
    },
  ];

  beforeEach(() => {
    offscreenWidth = 0;
    offscreenHeight = 0;
    vi.clearAllMocks();
    // Install mock OffscreenCanvas on globalThis
    (globalThis as unknown as Record<string, unknown>).OffscreenCanvas = MockOffscreenCanvas;
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).OffscreenCanvas;
  });

  it('returns a Blob of type image/png', async () => {
    const { renderNestSheetPng } = await import('../renderNestSheetPng');
    const blob = await renderNestSheetPng(sheet, materials, { canvasWidthPx: 256 });
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('preserves sheet aspect ratio in output canvas', async () => {
    // Aspect = 1220/2440 = 0.5 → for canvasWidthPx=200, expect height = 100.
    const { renderNestSheetPng } = await import('../renderNestSheetPng');
    const blob = await renderNestSheetPng(sheet, materials, { canvasWidthPx: 200 });
    expect(blob.type).toBe('image/png');
    // The mock OffscreenCanvas captures the constructor args; verify the canvas
    // was created with the correct aspect-ratio dimensions (w=200, h=100).
    expect(offscreenWidth).toBe(200);
    expect(offscreenHeight).toBe(100);
    // Also verify the PNG IHDR bytes in the returned Blob match those dimensions.
    // Use FileReader since jsdom Blob may lack .arrayBuffer().
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(16, false)).toBe(200);
    expect(view.getUint32(20, false)).toBe(100);
  });
});
