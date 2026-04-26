import type { BomRow } from '@zilventor/shared/src/bomRow';

function csvCell(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function colorCell(c: BomRow['color']): string {
  if (!c) return '';
  return c.kind === 'palette' ? c.name : c.hex;
}

export function buildBomCsv(rows: BomRow[]): string {
  let out = 'Item#,QTY,Part Name,Color,Part Path\n';
  for (const r of rows) {
    out += [
      String(r.itemNumber),
      String(r.qty),
      csvCell(r.partName),
      csvCell(colorCell(r.color)),
      csvCell(r.partPath),
    ].join(',') + '\n';
  }
  return out;
}
