import type { CutListResult, GrainDirection } from '@zilventor/shared';

export interface PanelLabel {
  itemNumber: number;
  partName: string;
  materialName: string;
  length: number;
  width: number;
  thickness: number;
  grain: GrainDirection;
  /** Which edges carry banding (true = banded). */
  edges: { front: boolean; back: boolean; left: boolean; right: boolean };
  copyIndex: number; // 1-based
  copyCount: number; // === row.qty
  qrPayload: string;
}

/**
 * Flatten a cut-list into one label per physical panel: each row → qty labels,
 * copies 1..qty, in cut-list order.
 */
export function buildPanelLabels(result: CutListResult): PanelLabel[] {
  const out: PanelLabel[] = [];
  for (const row of result.rows) {
    for (let k = 1; k <= row.qty; k++) {
      out.push({
        itemNumber: row.itemNumber,
        partName: row.partName,
        materialName: row.materialName,
        length: row.length,
        width: row.width,
        thickness: row.thickness,
        grain: row.grain,
        edges: {
          front: row.edgeBands.front !== null,
          back: row.edgeBands.back !== null,
          left: row.edgeBands.left !== null,
          right: row.edgeBands.right !== null,
        },
        copyIndex: k,
        copyCount: row.qty,
        qrPayload: `Z|${row.itemNumber}|${k}/${row.qty}|${row.length}x${row.width}x${row.thickness}|${row.materialName}`,
      });
    }
  }
  return out;
}
