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

/**
 * BOM item number → ALL component paths for that item (preserving order).
 * Used by autoBalloonSheet to fall back to a visible instance when the first
 * component path has no projected edges in any view.
 */
export function componentPathsByItem(rows: readonly BomRow[]): Map<number, string[]> {
  const m = new Map<number, string[]>();
  for (const row of rows) {
    const existing = m.get(row.itemNumber);
    if (existing !== undefined) {
      existing.push(...row.componentIds);
    } else {
      m.set(row.itemNumber, [...row.componentIds]);
    }
  }
  return m;
}
