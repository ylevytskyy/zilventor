import type { CutListRow, EdgeBandTotal } from '@zilventor/shared/src/cutListRow';
import type { LinearMaterialBreakdown, LinearMaterialPiece } from '@zilventor/shared/src/linearMaterial';
import type { HardwareRow } from '../assembly/walkers/aggregateHardwareRecursive';
import type { ConnectorBomRow } from '../shell/ConnectorBomTable';

export interface StatisticsReportLine {
  key: string;
  label: string;
  qty: number;
  /** 'm2' is used by the panels/sheet-data category (area, not count or length). */
  unit: 'ea' | 'mm' | 'm2';
  unitPrice?: number;
  lineTotal?: number;
  /** Linear-material lines only — per-piece cut breakdown for ABF-style "1x958mm, 2x466mm" detail. */
  pieces?: LinearMaterialPiece[];
}

export interface StatisticsReportSection {
  category: 'hardware' | 'connectors' | 'edgeband' | 'linear' | 'panels';
  lines: StatisticsReportLine[];
  subtotal: number;
}

export interface StatisticsReport {
  sections: StatisticsReportSection[];
  grandTotal: number;
  unpricedLineCount: number;
}

export interface BuildStatisticsReportInput {
  hardwareRows: HardwareRow[];
  connectorRows: ConnectorBomRow[];
  bandTotals: EdgeBandTotal[];
  linearBreakdowns: LinearMaterialBreakdown[];
  panelRows: CutListRow[];
  unitPrices: Record<string, number>;
  defaultPriceBook: Record<string, number>;
}

/** Round to 3 decimals to clean off binary-float noise (matches buildCutListCsv's round3). */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

type PriceResult = { unitPrice?: number; lineTotal?: number; priced: boolean };

function priceLine(
  key: string,
  qty: number,
  unitPrices: Record<string, number>,
  defaultPriceBook: Record<string, number>,
): PriceResult {
  const unitPrice = unitPrices[key] ?? defaultPriceBook[key];
  if (unitPrice === undefined) return { priced: false };
  return { unitPrice, lineTotal: qty * unitPrice, priced: true };
}

function buildSection(
  category: StatisticsReportSection['category'],
  lines: StatisticsReportLine[],
): StatisticsReportSection {
  const subtotal = lines.reduce((sum, l) => sum + (l.lineTotal ?? 0), 0);
  return { category, lines, subtotal };
}

export function buildStatisticsReport(input: BuildStatisticsReportInput): StatisticsReport {
  const { hardwareRows, connectorRows, bandTotals, linearBreakdowns, panelRows, unitPrices, defaultPriceBook } =
    input;
  let unpricedLineCount = 0;

  const price = (key: string, qty: number): PriceResult => {
    const result = priceLine(key, qty, unitPrices, defaultPriceBook);
    if (!result.priced) unpricedLineCount++;
    return result;
  };

  const hardwareLines: StatisticsReportLine[] = hardwareRows.map((r) => {
    const key = `hardware:${r.skuId}`;
    const { unitPrice, lineTotal } = price(key, r.qty);
    return { key, label: r.name, qty: r.qty, unit: 'ea', ...(unitPrice !== undefined && { unitPrice, lineTotal }) };
  });

  const connectorLines: StatisticsReportLine[] = connectorRows.map((r) => {
    const key = `connector:${r.kind}`;
    const { unitPrice, lineTotal } = price(key, r.qty);
    return { key, label: r.name, qty: r.qty, unit: 'ea', ...(unitPrice !== undefined && { unitPrice, lineTotal }) };
  });

  const edgebandLines: StatisticsReportLine[] = bandTotals.map((b) => {
    const key = `edgeband:${b.materialId}`;
    const { unitPrice, lineTotal } = price(key, b.totalLengthMm);
    return {
      key,
      label: b.materialName,
      qty: b.totalLengthMm,
      unit: 'mm',
      ...(unitPrice !== undefined && { unitPrice, lineTotal }),
    };
  });

  const linearLines: StatisticsReportLine[] = linearBreakdowns.map((lb) => {
    const key = `linear:${lb.materialId}`;
    const { unitPrice, lineTotal } = price(key, lb.totalLengthMm);
    return {
      key,
      label: lb.materialName,
      qty: lb.totalLengthMm,
      unit: 'mm',
      pieces: lb.pieces,
      ...(unitPrice !== undefined && { unitPrice, lineTotal }),
    };
  });

  const panelAcc = new Map<string, { materialName: string; areaM2: number }>();
  for (const row of panelRows) {
    const areaM2 = (row.length * row.width * row.qty) / 1e6;
    const existing = panelAcc.get(row.materialId);
    if (existing) existing.areaM2 += areaM2;
    else panelAcc.set(row.materialId, { materialName: row.materialName, areaM2 });
  }
  const panelLines: StatisticsReportLine[] = Array.from(panelAcc.entries()).map(([materialId, v]) => {
    const key = `material:${materialId}`;
    const qty = round3(v.areaM2);
    const { unitPrice, lineTotal } = price(key, qty);
    return { key, label: v.materialName, qty, unit: 'm2', ...(unitPrice !== undefined && { unitPrice, lineTotal }) };
  });

  const sections: StatisticsReportSection[] = [
    buildSection('hardware', hardwareLines),
    buildSection('connectors', connectorLines),
    buildSection('edgeband', edgebandLines),
    buildSection('linear', linearLines),
    buildSection('panels', panelLines),
  ];

  const grandTotal = sections.reduce((sum, s) => sum + s.subtotal, 0);

  return { sections, grandTotal, unpricedLineCount };
}
