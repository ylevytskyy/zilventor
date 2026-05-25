import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  makeFixtureDrawing,
  makeFixturePart,
  makeFixtureDrawingWithParentAndDetail,
  makeFixtureDrawingWithParentAndRectDetail,
} from '../../__tests__/fixtures/drawingFixtures';

/**
 * Builds a minimal valid PNG Uint8Array (signature + IHDR chunk).
 */
function makeFakePng(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(24);
  const view = new DataView(buf.buffer);
  // PNG signature
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47;
  buf[4] = 0x0d; buf[5] = 0x0a; buf[6] = 0x1a; buf[7] = 0x0a;
  // IHDR chunk length = 13
  view.setUint32(8, 13, false);
  // "IHDR"
  buf[12] = 0x49; buf[13] = 0x48; buf[14] = 0x44; buf[15] = 0x52;
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return buf;
}

let mockCanvasWidth = 0;
let mockCanvasHeight = 0;

const mockCtx = {
  fillStyle: '',
  fillRect: vi.fn(),
  drawImage: vi.fn(),
};

class MockOffscreenCanvas {
  constructor(width: number, height: number) {
    mockCanvasWidth = width;
    mockCanvasHeight = height;
  }
  getContext(_type: string) {
    return mockCtx;
  }
  convertToBlob(_opts?: { type?: string }): Promise<Blob> {
    const bytes = makeFakePng(mockCanvasWidth, mockCanvasHeight);
    return Promise.resolve(new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' }));
  }
}

describe('renderDrawingPngForSheet', () => {
  beforeEach(() => {
    mockCanvasWidth = 0;
    mockCanvasHeight = 0;
    vi.clearAllMocks();
    (globalThis as unknown as Record<string, unknown>).OffscreenCanvas = MockOffscreenCanvas;
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).OffscreenCanvas;
  });

  it('returns a Blob with type image/png', async () => {
    const { renderDrawingPngForSheet } = await import('../renderDrawingPngForSheet');
    const drawing = makeFixtureDrawing();
    const sheet = drawing.sheets[0]!;
    const blob = await renderDrawingPngForSheet(drawing, sheet, makeFixturePart(), { canvasWidthPx: 256 });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
  });

  it('has non-zero size', async () => {
    const { renderDrawingPngForSheet } = await import('../renderDrawingPngForSheet');
    const drawing = makeFixtureDrawing();
    const sheet = drawing.sheets[0]!;
    const blob = await renderDrawingPngForSheet(drawing, sheet, makeFixturePart(), { canvasWidthPx: 256 });
    expect(blob.size).toBeGreaterThan(0);
  });

  it('starts with PNG magic bytes', async () => {
    const { renderDrawingPngForSheet } = await import('../renderDrawingPngForSheet');
    const drawing = makeFixtureDrawing();
    const sheet = drawing.sheets[0]!;
    const blob = await renderDrawingPngForSheet(drawing, sheet, makeFixturePart(), { canvasWidthPx: 256 });
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
    // PNG magic: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
    expect(Array.from(bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});

describe('renderDrawingPngForSheet — detail view', () => {
  beforeEach(() => {
    mockCanvasWidth = 0;
    mockCanvasHeight = 0;
    vi.clearAllMocks();
    (globalThis as unknown as Record<string, unknown>).OffscreenCanvas = MockOffscreenCanvas;
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).OffscreenCanvas;
  });

  it('returns a Blob (type image/png) for a drawing that contains a detail view', async () => {
    const { renderDrawingPngForSheet } = await import('../renderDrawingPngForSheet');
    const drawing = makeFixtureDrawingWithParentAndDetail();
    const sheet = drawing.sheets[0]!;
    const blob = await renderDrawingPngForSheet(drawing, sheet, makeFixturePart(), { canvasWidthPx: 256 });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
  });

  it('PNG blob has non-zero size with detail view present', async () => {
    const { renderDrawingPngForSheet } = await import('../renderDrawingPngForSheet');
    const drawing = makeFixtureDrawingWithParentAndDetail();
    const sheet = drawing.sheets[0]!;
    const blob = await renderDrawingPngForSheet(drawing, sheet, makeFixturePart(), { canvasWidthPx: 256 });
    expect(blob.size).toBeGreaterThan(0);
  });
});

describe('renderDrawingPngForSheet — rect detail view (F2.1)', () => {
  beforeEach(() => {
    mockCanvasWidth = 0;
    mockCanvasHeight = 0;
    vi.clearAllMocks();
    (globalThis as unknown as Record<string, unknown>).OffscreenCanvas = MockOffscreenCanvas;
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).OffscreenCanvas;
  });

  it('returns a Blob (type image/png) for a drawing with a rect detail view', async () => {
    const { renderDrawingPngForSheet } = await import('../renderDrawingPngForSheet');
    const drawing = makeFixtureDrawingWithParentAndRectDetail();
    const sheet = drawing.sheets[0]!;
    const blob = await renderDrawingPngForSheet(drawing, sheet, makeFixturePart(), { canvasWidthPx: 256 });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
  });

  it('PNG blob has non-zero size with rect detail view present', async () => {
    const { renderDrawingPngForSheet } = await import('../renderDrawingPngForSheet');
    const drawing = makeFixtureDrawingWithParentAndRectDetail();
    const sheet = drawing.sheets[0]!;
    const blob = await renderDrawingPngForSheet(drawing, sheet, makeFixturePart(), { canvasWidthPx: 256 });
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renderDrawingPngForSheet delegates to renderDrawingSvg (no throw for rect)', async () => {
    const { renderDrawingPngForSheet } = await import('../renderDrawingPngForSheet');
    const drawing = makeFixtureDrawingWithParentAndRectDetail();
    const sheet = drawing.sheets[0]!;
    await expect(
      renderDrawingPngForSheet(drawing, sheet, makeFixturePart(), { canvasWidthPx: 256 })
    ).resolves.toBeInstanceOf(Blob);
  });
});
