import type { CutListEdgeBandCell, CutListResult, CutListRow, EdgeBandTotal } from '@zilventor/shared/src/cutListRow';
import type { HardwareRow } from '../assembly/walkers/aggregateHardwareRecursive';
import type { ConnectorBomRow } from '../shell/ConnectorBomTable';

function csvCell(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function num(n: number): string {
  // No thousands separator, no trailing zeros — Number.toString() already does this.
  return Number.isInteger(n) ? String(n) : String(n);
}

function bandLabel(c: CutListEdgeBandCell): string {
  return c ? c.materialName : '';
}

function rowLine(r: CutListRow): string {
  return [
    String(r.itemNumber),
    String(r.qty),
    csvCell(r.materialName),
    num(r.length),
    num(r.width),
    num(r.thickness),
    r.grain,
    csvCell(bandLabel(r.edgeBands.front)),
    csvCell(bandLabel(r.edgeBands.back)),
    csvCell(bandLabel(r.edgeBands.left)),
    csvCell(bandLabel(r.edgeBands.right)),
    csvCell(r.partName),
    csvCell(r.partPath),
  ].join(',');
}

function bandLine(b: EdgeBandTotal): string {
  const meters = (b.totalLengthMm / 1000).toFixed(3);
  return [csvCell(b.materialName), String(b.totalLengthMm), meters].join(',');
}

function hardwareRowLine(r: HardwareRow): string {
  return [
    csvCell(r.skuId),
    csvCell(r.name),
    r.category,
    String(r.qty),
    csvCell(r.notes),
  ].join(',');
}

function connectorRowLine(r: ConnectorBomRow): string {
  return [
    r.kind,           // enum value — never contains commas; no csvCell needed
    csvCell(r.name),  // user-visible string — may contain commas
    String(r.qty),
    csvCell(r.notes), // may contain commas/special chars
  ].join(',');
}

export function buildCutListCsv(
  result: CutListResult,
  hardwareRows: HardwareRow[] = [],
  connectorRows: ConnectorBomRow[] = [],
): string {
  const out: string[] = [];
  out.push('Item#,QTY,Material,L (mm),W (mm),T (mm),Grain,Front,Back,Left,Right,Part Name,Part Path');
  for (const r of result.rows) out.push(rowLine(r));
  out.push('');
  out.push('Edge Band Material,Total Length (mm),Total Length (m)');
  for (const b of result.bandTotals) out.push(bandLine(b));
  out.push('');
  out.push('# Hardware');
  out.push('SKU,Name,Category,Qty,Notes');
  for (const r of hardwareRows) out.push(hardwareRowLine(r));
  if (connectorRows.length > 0) {
    out.push('');
    out.push('# присадка / Connectors');
    out.push('Type,Name,Qty,Notes');
    for (const r of connectorRows) out.push(connectorRowLine(r));
  }
  out.push('');
  out.push(
    `Excluded from cut list,${result.excluded.componentCount} components,${result.excluded.partCount} distinct parts`,
  );
  return out.join('\n') + '\n';
}
