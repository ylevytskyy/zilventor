import type { StatisticsReport, StatisticsReportLine, StatisticsReportSection } from './buildStatisticsReport';

const SECTION_TITLES: Record<StatisticsReportSection['category'], string> = {
  hardware: 'Hardware',
  connectors: 'Connectors',
  edgeband: 'Edge Band',
  linear: 'Linear Material',
  panels: 'Panels',
};

function csvCell(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function num(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n);
}

function lineRow(line: StatisticsReportLine): string {
  return [
    csvCell(line.label),
    num(line.qty),
    line.unit,
    line.unitPrice !== undefined ? num(line.unitPrice) : '',
    line.lineTotal !== undefined ? num(line.lineTotal) : '',
  ].join(',');
}

function pieceRow(lengthMm: number, qty: number): string {
  return `  ${qty} x ${lengthMm}mm`;
}

function sectionLines(section: StatisticsReportSection): string[] {
  const out: string[] = [`# ${SECTION_TITLES[section.category]}`, 'Label,Qty,Unit,Unit Price,Line Total'];
  for (const line of section.lines) {
    out.push(lineRow(line));
    if (line.pieces) {
      for (const p of line.pieces) out.push(pieceRow(p.lengthMm, p.qty));
    }
  }
  out.push(`Subtotal,,,,${num(section.subtotal)}`);
  return out;
}

export function buildStatisticsCsv(report: StatisticsReport): string {
  const out: string[] = [];
  for (const section of report.sections) {
    out.push(...sectionLines(section));
    out.push('');
  }
  out.push(`Grand Total,,,,${num(report.grandTotal)}`);
  out.push(`Unpriced lines,${report.unpricedLineCount}`);
  return out.join('\n') + '\n';
}
