import type { CutListRow } from './cutListRow';
import type { MaterialId, MaterialRegistry } from './material';

export type LinearMaterialPiece = {
  lengthMm: number;
  qty: number;
};

export type LinearMaterialBreakdown = {
  materialId: MaterialId;
  materialName: string;
  pieces: LinearMaterialPiece[];
  totalPieceCount: number;
  totalLengthMm: number;
};

type LinearAcc = {
  materialName: string;
  pieces: LinearMaterialPiece[];
};

/**
 * Split cut-list rows into panel/sheet rows and a per-material linear-material
 * cut-piece breakdown, matching ABF's "3 rods: 1x958mm, 2x466mm" reporting style.
 *
 * A row's cut length is the LONGER of its two planar dimensions (length/width) —
 * a rod's "length" is its long axis, and CutListRow.length isn't guaranteed to be
 * the larger value for grain !== 'none' rows (normalizeLW only orders L>=W when
 * grain === 'none').
 */
export function partitionLinearMaterial(
  rows: CutListRow[],
  materials: MaterialRegistry,
): { panelRows: CutListRow[]; linearBreakdowns: LinearMaterialBreakdown[] } {
  const panelRows: CutListRow[] = [];
  const acc = new Map<MaterialId, LinearAcc>();

  for (const row of rows) {
    const material = materials.find((m) => m.id === row.materialId);
    if (material?.kind !== 'linear') {
      panelRows.push(row);
      continue;
    }
    const lengthMm = Math.max(row.length, row.width);
    const existing = acc.get(row.materialId);
    if (existing) {
      existing.pieces.push({ lengthMm, qty: row.qty });
    } else {
      acc.set(row.materialId, { materialName: row.materialName, pieces: [{ lengthMm, qty: row.qty }] });
    }
  }

  const linearBreakdowns: LinearMaterialBreakdown[] = Array.from(acc.entries()).map(
    ([materialId, v]) => {
      const pieces = [...v.pieces].sort((a, b) => b.lengthMm - a.lengthMm);
      let totalPieceCount = 0;
      let totalLengthMm = 0;
      for (const p of pieces) {
        totalPieceCount += p.qty;
        totalLengthMm += p.lengthMm * p.qty;
      }
      return { materialId, materialName: v.materialName, pieces, totalPieceCount, totalLengthMm };
    },
  );

  return { panelRows, linearBreakdowns };
}
