import type { CutListResult, GrainDirection, NestState } from '@zilventor/shared';

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
  /** True when this specific physical copy was nested rotated 90°. */
  rotated: boolean;
}

/**
 * Flatten a cut-list into one label per physical panel: each row → qty labels,
 * copies 1..qty, in cut-list order. When `nest` is provided, each label's
 * `rotated` flag reflects that copy's actual as-nested rotation (matched by
 * rowKey + instanceIndex); otherwise (or if unmatched) it defaults to false.
 */
export function buildPanelLabels(result: CutListResult, nest?: NestState): PanelLabel[] {
  const out: PanelLabel[] = [];
  for (const row of result.rows) {
    for (let k = 1; k <= row.qty; k++) {
      const placed = nest?.sheets
        .flatMap((sheet) => sheet.panels)
        .find((p) => p.rowKey === row.rowKey && p.instanceIndex === k);
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
        rotated: placed?.rotated ?? false,
      });
    }
  }
  return out;
}
