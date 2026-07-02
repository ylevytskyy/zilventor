import type { NestSheet } from '@zilventor/shared';
import type { MaterialRegistry } from '@zilventor/shared/src/material';

export async function renderNestSheetPng(
  sheet: NestSheet,
  materials: MaterialRegistry,
  opts: { canvasWidthPx: number },
): Promise<Blob> {
  const aspect = sheet.sheetWidthMm / sheet.sheetLengthMm;
  const width = opts.canvasWidthPx;
  const height = Math.max(1, Math.round(width * aspect));

  // Prefer OffscreenCanvas; fall back to a regular <canvas> for environments lacking it (test JSDOM).
  type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  let canvas: HTMLCanvasElement | OffscreenCanvas;
  let toBlob: () => Promise<Blob>;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(width, height);
    toBlob = () => (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' });
  } else {
    canvas = document.createElement('canvas');
    (canvas as HTMLCanvasElement).width = width;
    (canvas as HTMLCanvasElement).height = height;
    toBlob = () =>
      new Promise<Blob>((resolve, reject) => {
        (canvas as HTMLCanvasElement).toBlob(
          (b) => (b ? resolve(b) : reject(new Error('toBlob null'))),
          'image/png',
        );
      });
  }
  const ctx = canvas.getContext('2d') as Canvas2D | null;
  if (!ctx) throw new Error('2d context unavailable');

  const material = materials.find((m) => m.id === sheet.materialId);
  drawSheetCanvas(ctx, sheet, material?.color ?? '#dddddd', width, height);

  return toBlob();
}

function drawSheetCanvas(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  sheet: NestSheet,
  fill: string,
  widthPx: number,
  heightPx: number,
): void {
  const scale = widthPx / sheet.sheetLengthMm;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, widthPx, heightPx);
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, widthPx, heightPx);

  for (const p of sheet.panels) {
    const x = p.x * scale;
    const y = p.y * scale;
    const w = p.length * scale;
    const h = p.width * scale;
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#222';
    ctx.font = '14px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(`#${p.itemNumber}`, x + 4, y + 4);
    if (p.length > 200) {
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${p.length}×${p.width}`, x + w / 2, y + h / 2);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'top';
    }
  }

  if (sheet.remnant) {
    const r = sheet.remnant;
    const x = r.x * scale;
    const y = r.y * scale;
    const w = r.length * scale;
    const h = r.width * scale;
    ctx.strokeStyle = '#c00';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = '#c00';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`REMNANT ${r.length}×${r.width}`, x + w / 2, y + h / 2);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'top';
  }
}
