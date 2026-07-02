import ExcelJS from 'exceljs';
import type { StatisticsReport, StatisticsReportSection } from './buildStatisticsReport';

const SECTION_SHEET_NAMES: Record<StatisticsReportSection['category'], string> = {
  hardware: 'Hardware',
  connectors: 'Connectors',
  edgeband: 'Edge Band',
  linear: 'Linear Material',
  panels: 'Panels',
};

const COLUMNS: { header: string; width: number }[] = [
  { header: 'Label', width: 32 },
  { header: 'Qty', width: 12 },
  { header: 'Unit', width: 10 },
  { header: 'Unit Price', width: 12 },
  { header: 'Line Total', width: 14 },
];

function addSectionSheet(wb: ExcelJS.Workbook, section: StatisticsReportSection): void {
  const ws = wb.addWorksheet(SECTION_SHEET_NAMES[section.category]);
  ws.columns = COLUMNS;
  for (const line of section.lines) {
    ws.addRow([line.label, line.qty, line.unit, line.unitPrice ?? '', line.lineTotal ?? '']);
    if (line.pieces) {
      for (const p of line.pieces) ws.addRow([`  ${p.qty} x ${p.lengthMm}mm`]);
    }
  }
  ws.addRow(['Subtotal', '', '', '', section.subtotal]);
}

function addSummarySheet(wb: ExcelJS.Workbook, report: StatisticsReport): void {
  const ws = wb.addWorksheet('Summary');
  ws.columns = [{ header: 'Section', width: 20 }, { header: 'Subtotal', width: 14 }];
  for (const section of report.sections) {
    ws.addRow([SECTION_SHEET_NAMES[section.category], section.subtotal]);
  }
  ws.addRow([]);
  ws.addRow(['Grand Total', report.grandTotal]);
  ws.addRow(['Unpriced lines', report.unpricedLineCount]);
}

export async function buildStatisticsXlsxBuffer(report: StatisticsReport): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  for (const section of report.sections) addSectionSheet(wb, section);
  addSummarySheet(wb, report);
  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
