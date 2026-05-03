import type { CutListEdgeBandCell, CutListResult, CutListRow, EdgeBandTotal } from '@zilventor/shared/src/cutListRow';

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

export function buildCutListCsv(result: CutListResult): string {
  const out: string[] = [];
  out.push('Item#,QTY,Material,L (mm),W (mm),T (mm),Grain,Front,Back,Left,Right,Part Name,Part Path');
  for (const r of result.rows) out.push(rowLine(r));
  out.push('');
  out.push('Edge Band Material,Total Length (mm),Total Length (m)');
  for (const b of result.bandTotals) out.push(bandLine(b));
  out.push('');
  out.push(
    `Excluded from cut list,${result.excluded.componentCount} components,${result.excluded.partCount} distinct parts`,
  );
  return out.join('\n') + '\n';
}
