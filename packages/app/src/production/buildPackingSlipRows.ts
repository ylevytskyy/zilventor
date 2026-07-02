import type { CutListResult } from '@zilventor/shared';
import { producedPanelKey } from '@zilventor/shared/src/production/qrPayload';

export interface PackingSlipRow {
  itemNumber: number;
  partName: string;
  materialName: string;
  length: number;
  width: number;
  thickness: number;
  qty: number;
  producedCount: number;
  remainingCount: number;
}

/** Per cut-list row, tallies how many of its physical copies are marked produced. */
export function buildPackingSlipRows(
  cutListResult: CutListResult,
  producedPanels: Record<string, boolean> | undefined,
): PackingSlipRow[] {
  return cutListResult.rows.map((row) => {
    let producedCount = 0;
    for (let k = 1; k <= row.qty; k++) {
      if (producedPanels?.[producedPanelKey(row.itemNumber, k)] === true) producedCount++;
    }
    return {
      itemNumber: row.itemNumber,
      partName: row.partName,
      materialName: row.materialName,
      length: row.length,
      width: row.width,
      thickness: row.thickness,
      qty: row.qty,
      producedCount,
      remainingCount: row.qty - producedCount,
    };
  });
}
