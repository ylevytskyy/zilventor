import { jsPDF } from 'jspdf';
import type { DrawingSheet, DrawingView, DetailView } from '@zilventor/shared';
import type { DrawingDocument } from '@zilventor/shared';
import type { PartDocument, AssemblyDocument } from '@zilventor/shared';
import { resolveTitleBlock } from '@zilventor/shared/src/drawing/titleBlock';
import type { ResolvedTitleBlock } from '@zilventor/shared/src/drawing/titleBlock';

// ISO sheet dimensions (mm, landscape).
const ISO_SIZES_MM: Record<string, { w: number; h: number }> = {
  A0: { w: 1189, h: 841 },
  A1: { w: 841,  h: 594 },
  A2: { w: 594,  h: 420 },
  A3: { w: 420,  h: 297 },
  A4: { w: 297,  h: 210 },
};

/** Returns a PDF Blob (application/pdf), one page per sheet. */
export function renderDrawingPdf(
  drawing: DrawingDocument,
  source: PartDocument | AssemblyDocument,
): Blob {
  return buildPdf(drawing, source).output('blob') as Blob;
}

/** Returns raw PDF bytes (Uint8Array). Used by ExportDrawingPdfCommand. */
export function renderDrawingPdfBytes(
  drawing: DrawingDocument,
  source: PartDocument | AssemblyDocument,
): Uint8Array {
  return new Uint8Array(buildPdf(drawing, source).output('arraybuffer') as ArrayBuffer);
}

function buildPdf(
  drawing: DrawingDocument,
  source: PartDocument | AssemblyDocument,
): jsPDF {
  const sheets = drawing.sheets;
  if (sheets.length === 0) {
    const empty = new jsPDF({ unit: 'mm', format: 'a3', orientation: 'landscape' });
    empty.text('No sheets', 20, 20);
    return empty;
  }

  const { format: firstFormat, orientation: firstOrientation } = sheetFormat(sheets[0]!);
  const pdf = new jsPDF({ unit: 'mm', format: firstFormat, orientation: firstOrientation });

  sheets.forEach((sheet, i) => {
    const { format, orientation } = sheetFormat(sheet);
    if (i === 0) {
      if (orientation !== 'landscape') {
        pdf.deletePage(1);
        pdf.addPage(format, orientation);
      }
    } else {
      pdf.addPage(format, orientation);
    }
    drawSheetPdf(pdf, sheet, drawing, source, i, sheets.length);
  });

  return pdf;
}

function sheetFormat(
  sheet: DrawingSheet,
): { format: string | [number, number]; orientation: 'landscape' | 'portrait' } {
  const orientation = sheet.orientation;
  if (sheet.size.kind === 'iso') {
    const key = sheet.size.size.toLowerCase();
    return { format: key, orientation };
  }
  const { widthMm, heightMm } = sheet.size;
  const format: [number, number] = orientation === 'landscape'
    ? [Math.max(widthMm, heightMm), Math.min(widthMm, heightMm)]
    : [Math.min(widthMm, heightMm), Math.max(widthMm, heightMm)];
  return { format, orientation };
}

function drawSheetPdf(
  pdf: jsPDF,
  sheet: DrawingSheet,
  drawing: DrawingDocument,
  source: PartDocument | AssemblyDocument,
  sheetIndex: number,
  totalSheets: number,
): void {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const MARGIN = 10;
  const TITLE_H = 20;

  const titleBlock = resolveTitleBlock(drawing, sheet, source, sheetIndex, totalSheets, '');
  drawTitleBlockPdf(pdf, titleBlock, pageW, pageH, MARGIN, TITLE_H);

  pdf.setDrawColor(0);
  pdf.setLineWidth(0.5);
  pdf.rect(MARGIN, MARGIN, pageW - 2 * MARGIN, pageH - 2 * MARGIN - TITLE_H);

  const drawAreaW = pageW - 2 * MARGIN;
  const drawAreaH = pageH - 2 * MARGIN - TITLE_H;
  const sheetPhysW = getSheetWidthMm(sheet);
  const sheetPhysH = getSheetHeightMm(sheet);
  const scaleX = drawAreaW / sheetPhysW;
  const scaleY = drawAreaH / sheetPhysH;

  for (const view of sheet.views) {
    drawViewPdf(pdf, view, MARGIN, MARGIN, scaleX, scaleY);
  }

  // Detail callout circles on parent views.
  for (const view of sheet.views) {
    if (view.kind !== 'detail') continue;
    const dv = view as DetailView;
    const parent = sheet.views.find((v) => v.id === dv.parentViewId);
    if (!parent) continue;
    const parentScale = parent.scale.numerator / parent.scale.denominator;
    const cx = MARGIN + (parent.positionMm.x + dv.regionParent.center.x * parentScale) * scaleX;
    const cy = MARGIN + (parent.positionMm.y + dv.regionParent.center.y * parentScale) * scaleY;
    // TODO(batch-5): add rect branch; for now circle arm only
    const r = (dv.regionParent.kind === 'circle' ? dv.regionParent.radiusMm : 0) * parentScale * scaleX;
    pdf.setDrawColor(0);
    pdf.setLineWidth(0.35);
    pdf.circle(cx, cy, r, 'S');
    const COS45 = Math.SQRT1_2;
    const labelX = cx + (r + 5 * scaleX) * COS45;
    const labelY = cy - (r + 5 * scaleY) * COS45;
    pdf.setFontSize(7);
    pdf.setTextColor(0);
    pdf.text(dv.label, labelX, labelY);
  }

  for (const dim of sheet.dimensions) {
    const relView = sheet.views.find((v) => v.id === dim.viewId);
    if (!relView) continue;
    drawDimensionPdf(pdf, dim, relView, MARGIN, MARGIN, scaleX, scaleY);
  }
}

function drawTitleBlockPdf(
  pdf: jsPDF,
  fields: ResolvedTitleBlock,
  pageW: number,
  pageH: number,
  margin: number,
  titleH: number,
): void {
  const x = margin;
  const y = pageH - margin - titleH;
  const w = pageW - 2 * margin;

  pdf.setDrawColor(0);
  pdf.setLineWidth(0.3);
  pdf.rect(x, y, w, titleH);
  pdf.line(x + w / 2, y, x + w / 2, y + titleH);

  pdf.setFontSize(7);
  pdf.setTextColor(80);

  pdf.text(`Drawing: ${fields.drawingName ?? ''}`, x + 2, y + 4);
  pdf.text(`Part: ${fields.partName ?? ''}`, x + 2, y + 8);
  pdf.text(`Scale: ${fields.scaleText ?? '1:1'}`, x + 2, y + 12);
  pdf.text(`Material: ${fields.material ?? ''}`, x + 2, y + 16);

  pdf.text(`Date: ${fields.date ?? ''}`, x + w / 2 + 2, y + 4);
  pdf.text(`Drawn by: ${fields.drawnBy ?? ''}`, x + w / 2 + 2, y + 8);
  pdf.text(`Revision: ${fields.revision ?? ''}`, x + w / 2 + 2, y + 12);
  pdf.text(
    `Sheet: ${fields.sheetNumber.current}/${fields.sheetNumber.total}`,
    x + w / 2 + 2, y + 16,
  );

  pdf.setTextColor(0);
}

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

function drawViewPdf(
  pdf: jsPDF,
  view: DrawingView,
  ox: number,
  oy: number,
  scaleX: number,
  scaleY: number,
): void {
  const { projection } = view;
  if (!projection) return;

  const vScale = view.scale.numerator / view.scale.denominator;
  const vx = ox + view.positionMm.x * scaleX;
  const vy = oy + view.positionMm.y * scaleY;

  pdf.setDrawColor(0);
  pdf.setLineWidth(0.35);
  for (const edge of projection.visibleEdges) {
    drawPolylinePdf(pdf, edge.points, vx, vy, vScale * scaleX, vScale * scaleY);
  }

  pdf.setDrawColor(80);
  pdf.setLineWidth(0.18);
  for (const edge of projection.hiddenEdges) {
    drawPolylinePdf(pdf, edge.points, vx, vy, vScale * scaleX, vScale * scaleY);
  }
  pdf.setDrawColor(0);

  // Detail-specific: border circle + caption.
  if (view.kind === 'detail') {
    const dv = view as DetailView;
    // TODO(batch-5): add rect branch; for now circle arm only
    const borderR = (dv.regionParent.kind === 'circle' ? dv.regionParent.radiusMm : 0) * vScale * scaleX;
    pdf.setDrawColor(0);
    pdf.setLineWidth(0.35);
    pdf.circle(vx, vy, borderR, 'S');
    const captionX = vx + ((projection.bbox.minX + projection.bbox.maxX) / 2) * vScale * scaleX;
    const captionY = vy + (projection.bbox.maxY + 5) * vScale * scaleY;
    pdf.setFontSize(7);
    pdf.setTextColor(0);
    pdf.text(`DETAIL ${dv.label}`, captionX, captionY, { align: 'center' });
    pdf.text(`${dv.scale.numerator}:${dv.scale.denominator}`, captionX, captionY + 3.5 * scaleY, { align: 'center' });
  }
}

function drawPolylinePdf(
  pdf: jsPDF,
  points: ReadonlyArray<readonly [number, number]>,
  ox: number,
  oy: number,
  sx: number,
  sy: number,
): void {
  if (points.length < 2) return;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i] as readonly [number, number];
    const p1 = points[i + 1] as readonly [number, number];
    pdf.line(ox + p0[0] * sx, oy + p0[1] * sy, ox + p1[0] * sx, oy + p1[1] * sy);
  }
}

import type { DrawingDimension } from '@zilventor/shared';
import type { PointRef } from '@zilventor/shared/src/drawing/types';

function drawDimensionPdf(
  pdf: jsPDF,
  dim: DrawingDimension,
  view: DrawingView,
  ox: number,
  oy: number,
  scaleX: number,
  scaleY: number,
): void {
  if (!view.projection) return;
  const vScale = view.scale.numerator / view.scale.denominator;
  const vx = ox + view.positionMm.x * scaleX;
  const vy = oy + view.positionMm.y * scaleY;

  if (dim.kind === 'linear-h' || dim.kind === 'linear-v' || dim.kind === 'aligned') {
    const p1 = resolvePointRef(dim.from, view.projection);
    const p2 = resolvePointRef(dim.to, view.projection);
    if (!p1 || !p2) return;

    const x1 = vx + p1[0] * vScale * scaleX;
    const y1 = vy + p1[1] * vScale * scaleY;
    const x2 = vx + p2[0] * vScale * scaleX;
    const y2 = vy + p2[1] * vScale * scaleY;
    const offset = dim.offsetMm * scaleY;

    pdf.setDrawColor(0, 0, 180);
    pdf.setLineWidth(0.2);
    if (dim.kind === 'linear-h') {
      pdf.line(x1, y1 - offset, x2, y1 - offset);
      pdf.line(x1, y1, x1, y1 - offset);
      pdf.line(x2, y2, x2, y1 - offset);
    } else {
      pdf.line(x1 + offset, y1, x1 + offset, y2);
      pdf.line(x1, y1, x1 + offset, y1);
      pdf.line(x2, y2, x1 + offset, y2);
    }
    const distMm = Math.round(Math.sqrt((p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2));
    pdf.setFontSize(6);
    pdf.text(String(distMm), (x1 + x2) / 2, y1 - offset - 1, { align: 'center' });
    pdf.setDrawColor(0);
  }
}

function resolvePointRef(
  ref: PointRef,
  projection: NonNullable<DrawingView['projection']>,
): readonly [number, number] | null {
  const r = ref as { kind: string; edgeId?: string; end?: string };
  const edge = projection.visibleEdges.find((e) => e.id === r.edgeId)
    ?? projection.hiddenEdges.find((e) => e.id === r.edgeId);
  if (!edge || edge.points.length === 0) return null;
  if (r.end === 'end') return (edge.points[edge.points.length - 1] as readonly [number, number]);
  if (r.kind === 'edge-midpoint') return (edge.points[Math.floor(edge.points.length / 2)] as readonly [number, number]);
  return (edge.points[0] as readonly [number, number]);
}
