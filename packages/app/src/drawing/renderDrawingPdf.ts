import { jsPDF } from 'jspdf';
import type { DrawingSheet, DrawingView, DetailView, SectionView } from '@zilventor/shared';
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
  source: PartDocument | AssemblyDocument | null,
): Blob {
  return buildPdf(drawing, source).output('blob') as Blob;
}

/** Returns raw PDF bytes (Uint8Array). Used by ExportDrawingPdfCommand. */
export function renderDrawingPdfBytes(
  drawing: DrawingDocument,
  source: PartDocument | AssemblyDocument | null,
): Uint8Array {
  return new Uint8Array(buildPdf(drawing, source).output('arraybuffer') as ArrayBuffer);
}

function buildPdf(
  drawing: DrawingDocument,
  source: PartDocument | AssemblyDocument | null,
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
  source: PartDocument | AssemblyDocument | null,
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

  // Detail callout shapes on parent views.
  for (const view of sheet.views) {
    if (view.kind !== 'detail') continue;
    const dv = view as DetailView;
    const parent = sheet.views.find((v) => v.id === dv.parentViewId);
    if (!parent) continue;
    const parentScale = parent.scale.numerator / parent.scale.denominator;
    const cx = MARGIN + (parent.positionMm.x + dv.regionParent.center.x * parentScale) * scaleX;
    const cy = MARGIN + (parent.positionMm.y + dv.regionParent.center.y * parentScale) * scaleY;
    const rp = dv.regionParent;
    pdf.setDrawColor(0);
    pdf.setLineWidth(0.35);
    if (rp.kind === 'rect') {
      const cw = rp.widthMm * parentScale * scaleX;
      const ch = rp.heightMm * parentScale * scaleY;
      pdf.rect(cx - cw / 2, cy - ch / 2, cw, ch, 'S');
      pdf.setFontSize(7);
      pdf.setTextColor(0);
      pdf.text(dv.label, cx + cw / 2 + 2, cy - ch / 2 - 1);
    } else {
      // kind === 'circle'
      const r = rp.radiusMm * parentScale * scaleX;
      pdf.circle(cx, cy, r, 'S');
      const COS45 = Math.SQRT1_2;
      const labelX = cx + (r + 5 * scaleX) * COS45;
      const labelY = cy - (r + 5 * scaleY) * COS45;
      pdf.setFontSize(7);
      pdf.setTextColor(0);
      pdf.text(dv.label, labelX, labelY);
    }
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
  // Mid-divider stops 4mm above bottom to allow full-width notes row
  pdf.line(x + w / 2, y, x + w / 2, y + titleH - 4);

  pdf.setFontSize(7);
  pdf.setTextColor(80);

  // Left column
  pdf.text(`Drawing: ${fields.drawingName ?? ''}`, x + 2, y + 4);
  pdf.text(`Part: ${fields.partName ?? ''}`, x + 2, y + 8);
  pdf.text(`Scale: ${fields.scaleText ?? '1:1'}`, x + 2, y + 12);
  pdf.text(`Material: ${fields.material ?? ''}`, x + 2, y + 16);

  // Right column (admin)
  pdf.text(`Date: ${fields.date ?? ''}`, x + w / 2 + 2, y + 4);
  pdf.text(`Drawn by: ${fields.drawnBy ?? ''}`, x + w / 2 + 2, y + 8);
  pdf.text(`Approved by: ${fields.approvedBy ?? ''}`, x + w / 2 + 2, y + 12);
  pdf.text(`Revision: ${fields.revision ?? ''}`, x + w / 2 + 2, y + 16);

  // Full-width notes row at bottom
  pdf.text(`Notes: ${fields.notes ?? ''}`, x + 2, y + titleH - 1);

  // Sheet number (right)
  pdf.text(
    `Sheet: ${fields.sheetNumber.current}/${fields.sheetNumber.total}`,
    x + w - 30, y + 16,
  );

  pdf.setTextColor(0);

  // ISO first-angle projection symbol (bottom-right corner, ~12×8mm)
  // First-angle (ISO 128-30): trapezoid on LEFT (narrow edge left, wide edge right),
  // concentric circles on RIGHT.
  const symTrapX = x + w - 18; // left anchor = trapezoid narrow-edge x
  const symCy = y + titleH - 8;
  pdf.setDrawColor(0);
  pdf.setLineWidth(0.3);
  // Trapezoid: narrow (short) on LEFT, wide (tall) on RIGHT
  const trapW = 6;
  const halfHS = 2.5; const halfHT = 4;
  const tlx = symTrapX;           const tly = symCy - halfHS; // top-left (narrow)
  const trx = symTrapX + trapW;   const try_ = symCy - halfHT; // top-right (wide)
  const brx = symTrapX + trapW;   const bry = symCy + halfHT;  // bottom-right (wide)
  const blx = symTrapX;           const bly = symCy + halfHS;  // bottom-left (narrow)
  pdf.line(tlx, tly, trx, try_); // top edge
  pdf.line(trx, try_, brx, bry); // right edge
  pdf.line(brx, bry, blx, bly);  // bottom edge
  pdf.line(blx, bly, tlx, tly);  // left edge (closes trapezoid)
  // Circle: to the RIGHT of the trapezoid (gap 1mm), radius 3mm
  const symR = 3;
  const symCx = symTrapX + trapW + 1 + symR;
  pdf.circle(symCx, symCy, symR, 'S');
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

  // Base/projected/iso views: scale label below the bounding box.
  if ((view.kind === 'base' || view.kind === 'projected' || view.kind === 'iso') && projection) {
    const labelX = vx + ((projection.bbox.minX + projection.bbox.maxX) / 2) * vScale * scaleX;
    const labelY = vy + (projection.bbox.maxY + 7) * vScale * scaleY;
    const scaleStr = `SCALE ${view.scale.numerator}:${view.scale.denominator}`;
    pdf.setFontSize(7);
    pdf.setTextColor(0);
    pdf.text(scaleStr, labelX, labelY, { align: 'center' });
  }

  // Section view: "SECTION X-X" heading below the bbox.
  if (view.kind === 'section' && projection) {
    const sv = view as SectionView;
    const headingX = vx + ((projection.bbox.minX + projection.bbox.maxX) / 2) * vScale * scaleX;
    const headingY = vy + (projection.bbox.maxY + 7) * vScale * scaleY;
    pdf.setFontSize(7);
    pdf.setTextColor(0);
    pdf.text(`SECTION ${sv.label}-${sv.label}`, headingX, headingY, { align: 'center' });
  }

  // Detail-specific: border shape + caption.
  if (view.kind === 'detail') {
    const dv = view as DetailView;
    const rp = dv.regionParent;
    pdf.setDrawColor(0);
    pdf.setLineWidth(0.35);
    if (rp.kind === 'rect') {
      const bw = rp.widthMm * vScale * scaleX;
      const bh = rp.heightMm * vScale * scaleY;
      pdf.rect(vx - bw / 2, vy - bh / 2, bw, bh, 'S');
    } else {
      // kind === 'circle'
      const borderR = rp.radiusMm * vScale * scaleX;
      pdf.circle(vx, vy, borderR, 'S');
    }
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
import { circumcenterFromPolyline } from '@zilventor/shared/src/drawing/circumcenter';

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
    return;
  }

  if (dim.kind === 'radial') {
    const edge = view.projection.visibleEdges.find((e) => e.id === dim.edgeId)
      ?? view.projection.hiddenEdges.find((e) => e.id === dim.edgeId);
    if (!edge || edge.points.length < 3) return;

    const { cx, cy, r } = circumcenterFromPolyline(edge.points);
    const angleRad = (dim.angleDeg * Math.PI) / 180;
    const rimX = cx + r * Math.cos(angleRad);
    const rimY = cy + r * Math.sin(angleRad);
    const tipX = cx + (r + dim.offsetMm) * Math.cos(angleRad);
    const tipY = cy + (r + dim.offsetMm) * Math.sin(angleRad);

    // Sheet-space PDF coords
    const px1 = vx + cx   * vScale * scaleX;  const py1 = vy + cy   * vScale * scaleY;
    const px2 = vx + rimX * vScale * scaleX;  const py2 = vy + rimY * vScale * scaleY;
    const ptx = vx + (tipX + 1) * vScale * scaleX;
    const pty = vy + tipY * vScale * scaleY;

    pdf.setDrawColor(0, 0, 180);
    pdf.setLineWidth(0.2);
    pdf.line(px1, py1, px2, py2);
    pdf.setFontSize(6);
    pdf.text(`R${Math.round(r)}`, ptx, pty);
    pdf.setDrawColor(0);
    return;
  }

  if (dim.kind === 'diametric') {
    const edge = view.projection.visibleEdges.find((e) => e.id === dim.edgeId)
      ?? view.projection.hiddenEdges.find((e) => e.id === dim.edgeId);
    if (!edge || edge.points.length < 3) return;

    const { cx, cy, r } = circumcenterFromPolyline(edge.points);
    const angleRad = (dim.angleDeg * Math.PI) / 180;
    const rimAx = cx + r * Math.cos(angleRad);
    const rimAy = cy + r * Math.sin(angleRad);
    const rimBx = cx - r * Math.cos(angleRad);
    const rimBy = cy - r * Math.sin(angleRad);

    const px1 = vx + rimAx * vScale * scaleX; const py1 = vy + rimAy * vScale * scaleY;
    const px2 = vx + rimBx * vScale * scaleX; const py2 = vy + rimBy * vScale * scaleY;
    const ptx = vx + (rimAx + 1) * vScale * scaleX;
    const pty = vy + (rimAy - 1) * vScale * scaleY;

    pdf.setDrawColor(0, 0, 180);
    pdf.setLineWidth(0.2);
    pdf.line(px1, py1, px2, py2);
    pdf.setFontSize(6);
    pdf.text(`⌀${Math.round(2 * r)}`, ptx, pty);
    pdf.setDrawColor(0);
    return;
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
  if (r.kind === 'arc-center') {
    const { cx, cy } = circumcenterFromPolyline(edge.points);
    return [cx, cy] as const;
  }
  return (edge.points[0] as readonly [number, number]);
}
