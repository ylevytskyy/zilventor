import type { BomRow } from '@zilventor/shared/src/bomRow';

/** pathKey(componentPath) → BOM item number, for every component in every row. */
export function itemNumberByComponentPath(rows: readonly BomRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const row of rows) {
    for (const cid of row.componentIds) m.set(cid, row.itemNumber);
  }
  return m;
}

/** BOM item number → first (representative) component path for that item. */
export function representativePathByItem(rows: readonly BomRow[]): Map<number, string> {
  const m = new Map<number, string>();
  for (const row of rows) {
    const first = row.componentIds[0];
    if (first !== undefined && !m.has(row.itemNumber)) m.set(row.itemNumber, first);
  }
  return m;
}
