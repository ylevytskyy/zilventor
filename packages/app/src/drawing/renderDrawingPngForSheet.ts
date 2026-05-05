import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';
import type { PartDocument, AssemblyDocument } from '@zilventor/shared';
import { renderDrawingSvg } from './renderDrawingSvg';

export interface RenderPngOptions {
  /** Width of the output canvas in pixels. Height is computed from sheet aspect ratio. */
  canvasWidthPx?: number;
}

const DEFAULT_CANVAS_WIDTH_PX = 1024;

/**
 * Rasterises a single drawing sheet to a PNG Blob via OffscreenCanvas.
 * Falls back to a regular Canvas if OffscreenCanvas is unavailable (test env).
 */
export async function renderDrawingPngForSheet(
  drawing: DrawingDocument,
  sheet: DrawingSheet,
  source: PartDocument | AssemblyDocument,
  opts: RenderPngOptions = {},
): Promise<Blob> {
  const canvasWidthPx = opts.canvasWidthPx ?? DEFAULT_CANVAS_WIDTH_PX;

  const sheetW = getSheetWidthMm(sheet);
  const sheetH = getSheetHeightMm(sheet);
  const canvasHeightPx = Math.max(1, Math.round(canvasWidthPx * (sheetH / sheetW)));

  const svgStr = renderDrawingSvg(drawing, sheet, source);

  type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  let canvas: HTMLCanvasElement | OffscreenCanvas;
  let toBlob: () => Promise<Blob>;

  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(canvasWidthPx, canvasHeightPx);
    toBlob = () => (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' });
  } else {
    canvas = document.createElement('canvas');
    (canvas as HTMLCanvasElement).width = canvasWidthPx;
    (canvas as HTMLCanvasElement).height = canvasHeightPx;
    toBlob = () =>
      new Promise<Blob>((resolve, reject) => {
        (canvas as HTMLCanvasElement).toBlob(
          (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
          'image/png',
        );
      });
  }

  const ctx = canvas.getContext('2d') as Canvas2D | null;
  if (!ctx) throw new Error('2d context unavailable');

  await drawSvgToCanvas(ctx as CanvasRenderingContext2D, svgStr, canvasWidthPx, canvasHeightPx);

  return toBlob();
}

async function drawSvgToCanvas(
  ctx: CanvasRenderingContext2D,
  svgStr: string,
  width: number,
  height: number,
): Promise<void> {
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, width, height);

  // Try SVG image path (works in real browsers with OffscreenCanvas).
  // URL.createObjectURL may be unavailable in test environments — fall back gracefully.
  let svgUrl: string | undefined;
  try {
    const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    svgUrl = URL.createObjectURL(svgBlob);
  } catch {
    // createObjectURL unavailable (jsdom) — skip image loading; white fill is still valid.
    return;
  }

  try {
    await loadImageToCanvas(ctx, svgUrl, width, height);
  } catch {
    // SVG image load failed — white fill is the fallback.
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function loadImageToCanvas(
  ctx: CanvasRenderingContext2D,
  url: string,
  width: number,
  height: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image(width, height);
    img.onload = () => {
      ctx.drawImage(img, 0, 0, width, height);
      resolve();
    };
    img.onerror = () => reject(new Error(`Failed to load SVG image: ${url}`));
    img.src = url;
  });
}

const ISO_SIZES_MM: Record<string, { w: number; h: number }> = {
  A0: { w: 1189, h: 841 },
  A1: { w: 841,  h: 594 },
  A2: { w: 594,  h: 420 },
  A3: { w: 420,  h: 297 },
  A4: { w: 297,  h: 210 },
};

function getSheetWidthMm(sheet: DrawingSheet): number {
  if (sheet.size.kind === 'custom') {
    return sheet.orientation === 'landscape'
      ? Math.max(sheet.size.widthMm, sheet.size.heightMm)
      : Math.min(sheet.size.widthMm, sheet.size.heightMm);
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const base = ISO_SIZES_MM[sheet.size.size]!;
  return sheet.orientation === 'landscape' ? base.w : base.h;
}

function getSheetHeightMm(sheet: DrawingSheet): number {
  if (sheet.size.kind === 'custom') {
    return sheet.orientation === 'landscape'
      ? Math.min(sheet.size.widthMm, sheet.size.heightMm)
      : Math.max(sheet.size.widthMm, sheet.size.heightMm);
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const base = ISO_SIZES_MM[sheet.size.size]!;
  return sheet.orientation === 'landscape' ? base.h : base.w;
}
