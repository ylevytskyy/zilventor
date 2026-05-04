import type { CutListRow } from '../cutListRow';
import type { MaterialRegistry } from '../material';

export async function computeNestFingerprint(
  rows: readonly CutListRow[],
  materials: MaterialRegistry,
  kerfMm: number,
): Promise<string> {
  const payload = JSON.stringify({
    rows: rows
      .map((r) => ({
        rowKey: r.rowKey, qty: r.qty,
        length: r.length, width: r.width, thickness: r.thickness,
        materialId: r.materialId, grain: r.grain,
      }))
      .sort((a, b) => a.rowKey.localeCompare(b.rowKey)),
    sheetStock: materials
      .filter((m) => m.sheetLengthMm !== undefined && m.sheetWidthMm !== undefined)
      .map((m) => [m.id, m.sheetLengthMm!, m.sheetWidthMm!] as [string, number, number])
      .sort((a, b) => a[0].localeCompare(b[0])),
    kerfMm,
  });
  const buf = new TextEncoder().encode(payload);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
