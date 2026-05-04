import { jsPDF } from 'jspdf';
import type { NestState, NestSheet } from '@zilventor/shared';
import type { MaterialEntry, MaterialRegistry } from '@zilventor/shared/src/material';

/** Returns raw PDF bytes (Uint8Array). Used by ExportNestPdfCommand. */
export function renderNestPdfBytes(nest: NestState, materials: MaterialRegistry): Uint8Array {
  return new Uint8Array(buildPdf(nest, materials).output('arraybuffer') as ArrayBuffer);
}

/** Returns a PDF Blob (application/pdf). Convenience wrapper. */
export function renderNestPdf(nest: NestState, materials: MaterialRegistry): Blob {
  return buildPdf(nest, materials).output('blob');
}

function buildPdf(nest: NestState, materials: MaterialRegistry): jsPDF {
  if (nest.sheets.length === 0) {
    const empty = new jsPDF({ unit: 'mm', format: 'a3', orientation: 'landscape' });
    empty.text('No sheets', 20, 20);
    return empty;
  }

  const pdf = new jsPDF({ unit: 'mm', format: 'a3', orientation: 'landscape' });
  const totalsByMaterial = new Map<string, number>();
  nest.sheets.forEach((s) => totalsByMaterial.set(s.materialId, (totalsByMaterial.get(s.materialId) ?? 0) + 1));

  nest.sheets.forEach((sheet, i) => {
    const orientation: 'landscape' | 'portrait' =
      sheet.sheetLengthMm >= sheet.sheetWidthMm ? 'landscape' : 'portrait';
    if (i === 0) {
      if (orientation !== 'landscape') {
        pdf.deletePage(1);
        pdf.addPage('a3', orientation);
      }
    } else {
      pdf.addPage('a3', orientation);
    }
    const material = materials.find((m) => m.id === sheet.materialId);
    drawSheetPdf(pdf, sheet, material, totalsByMaterial.get(sheet.materialId) ?? 1, { marginMm: 10 });
  });

  return pdf;
}

function drawSheetPdf(
  pdf: jsPDF, sheet: NestSheet, material: MaterialEntry | undefined, totalForMat: number,
  opts: { marginMm: number },
): void {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = opts.marginMm;
  const titleH = 12;
  const drawW = pageW - 2 * margin;
  const drawH = pageH - 2 * margin - titleH;
  const scale = Math.min(drawW / sheet.sheetLengthMm, drawH / sheet.sheetWidthMm);

  // Title bar
  pdf.setFontSize(12);
  const title = `${material?.name ?? sheet.materialId} — Sheet ${sheet.sheetIndex}/${totalForMat} — ${sheet.utilizationPct}% util`;
  pdf.text(title, margin, margin + 6);

  // Sheet outline
  const ox = margin, oy = margin + titleH;
  pdf.setDrawColor(136); pdf.setLineWidth(0.4);
  pdf.rect(ox, oy, sheet.sheetLengthMm * scale, sheet.sheetWidthMm * scale);

  // Panels
  const fillRgb = hexToRgb(material?.color ?? '#dddddd');
  for (const p of sheet.panels) {
    const x = ox + p.x * scale;
    const y = oy + p.y * scale;
    const w = p.length * scale;
    const h = p.width * scale;
    pdf.setFillColor(fillRgb.r, fillRgb.g, fillRgb.b);
    pdf.setDrawColor(34); pdf.setLineWidth(0.2);
    pdf.rect(x, y, w, h, 'FD');
    pdf.setFontSize(9); pdf.setTextColor(34);
    pdf.text(`#${p.itemNumber}`, x + 1.5, y + 4);
    if (p.length > 200) {
      pdf.setFontSize(8);
      pdf.text(`${p.length}×${p.width}`, x + w / 2, y + h / 2, { align: 'center', baseline: 'middle' });
    }
  }
  pdf.setTextColor(0);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace('#', '');
  const expand = (s: string): string => s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  const e = expand(m);
  return { r: parseInt(e.slice(0, 2), 16), g: parseInt(e.slice(2, 4), 16), b: parseInt(e.slice(4, 6), 16) };
}
