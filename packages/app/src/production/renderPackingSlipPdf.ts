import { jsPDF } from 'jspdf';
import type { PackingSlipRow } from './buildPackingSlipRows';
import { installCyrillicFont } from '../vendor/pdfCyrillicFont';

export interface RenderPackingSlipPdfOpts {
  headerLine1?: string;
  headerLine2?: string;
}

const MARGIN_MM = 15;
const ROW_H_MM = 7;
const COLS = [
  { x: 0, w: 15, label: 'Item#' },
  { x: 15, w: 70, label: 'Part' },
  { x: 85, w: 45, label: 'Material / Size' },
  { x: 130, w: 20, label: 'Qty' },
  { x: 150, w: 25, label: 'Produced' },
  { x: 175, w: 25, label: 'Remaining' },
];

/** Returns raw PDF bytes (Uint8Array). Used by ExportPackingSlipPdfCommand. */
export function renderPackingSlipPdfBytes(rows: PackingSlipRow[], opts?: RenderPackingSlipPdfOpts): Uint8Array {
  return new Uint8Array(buildPdf(rows, opts).output('arraybuffer') as ArrayBuffer);
}

function buildPdf(rows: PackingSlipRow[], opts: RenderPackingSlipPdfOpts | undefined): jsPDF {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  installCyrillicFont(pdf);
  const pageH = pdf.internal.pageSize.getHeight();
  let y = MARGIN_MM;

  const drawHeader = (): void => {
    pdf.setFontSize(14);
    pdf.text('Packing Slip', MARGIN_MM, y);
    y += 6;
    pdf.setFontSize(10);
    if (opts?.headerLine1) { pdf.text(opts.headerLine1, MARGIN_MM, y); y += 5; }
    if (opts?.headerLine2) { pdf.text(opts.headerLine2, MARGIN_MM, y); y += 5; }
    y += 2;
    drawColumnHeaderRow();
  };

  const drawColumnHeaderRow = (): void => {
    pdf.setFontSize(8);
    for (const col of COLS) pdf.text(col.label, MARGIN_MM + col.x, y);
    y += 2;
    pdf.setDrawColor(0);
    pdf.setLineWidth(0.2);
    pdf.line(MARGIN_MM, y, MARGIN_MM + 200, y);
    y += 4;
  };

  drawHeader();

  let totalQty = 0, totalProduced = 0, totalRemaining = 0;

  for (const row of rows) {
    if (y + ROW_H_MM > pageH - MARGIN_MM) {
      pdf.addPage('a4', 'portrait');
      y = MARGIN_MM;
      drawColumnHeaderRow();
    }
    pdf.setFontSize(9);
    pdf.text(String(row.itemNumber), MARGIN_MM + COLS[0]!.x, y);
    pdf.text(row.partName, MARGIN_MM + COLS[1]!.x, y);
    pdf.text(`${row.materialName} ${row.length}x${row.width}x${row.thickness}`, MARGIN_MM + COLS[2]!.x, y);
    pdf.text(String(row.qty), MARGIN_MM + COLS[3]!.x, y);
    pdf.text(String(row.producedCount), MARGIN_MM + COLS[4]!.x, y);
    pdf.text(String(row.remainingCount), MARGIN_MM + COLS[5]!.x, y);
    y += ROW_H_MM;

    totalQty += row.qty;
    totalProduced += row.producedCount;
    totalRemaining += row.remainingCount;
  }

  if (y + ROW_H_MM > pageH - MARGIN_MM) {
    pdf.addPage('a4', 'portrait');
    y = MARGIN_MM;
  }
  y += 2;
  pdf.setDrawColor(0);
  pdf.setLineWidth(0.2);
  pdf.line(MARGIN_MM, y, MARGIN_MM + 200, y);
  y += 5;
  pdf.setFontSize(9);
  pdf.text(`Totals: qty ${totalQty}  produced ${totalProduced}  remaining ${totalRemaining}`, MARGIN_MM, y);

  return pdf;
}
