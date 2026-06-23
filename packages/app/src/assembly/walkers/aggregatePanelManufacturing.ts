import type { CutListResult, CutListRow, BoreOp, GrooveFeature } from '@zilventor/shared';
import type { BoringAggregateResult } from './aggregateBoresRecursive';
import type { PanelManufacturingInput } from '../../drawing/renderPanelManufacturingDxf';

function faceKey(face: BoreOp['face']): string {
  if (typeof face === 'string') return face as string;
  return `${(face as any).featureId}:${(face as any).role}:${(face as any).instance ?? 0}`;
}

function sortBores(bores: BoreOp[]): BoreOp[] {
  return [...bores].sort((a, b) => {
    const fa = faceKey(a.face);
    const fb = faceKey(b.face);
    return fa.localeCompare(fb) || a.u - b.u || a.v - b.v ||
      a.diameter - b.diameter || String(a.depth).localeCompare(String(b.depth));
  });
}

export function machiningSignature(
  row: CutListRow,
  bores: BoreOp[],
  grooves: GrooveFeature[],
): string {
  const geo = `${row.length}x${row.width}x${row.thickness}|${row.materialId}|${row.grain}`;
  const b = sortBores(bores)
    .map((x) => `${faceKey(x.face)}:${x.u}:${x.v}:${x.diameter}:${x.depth}`).join(',');
  const g = [...grooves]
    .map((x) => `${x.faceRole}:${x.axis}:${x.position}:${x.width}:${x.depth}`)
    .sort()
    .join(',');
  return `${geo}#${b}#${g}`;
}

export function aggregatePanelManufacturing(
  cutList: CutListResult,
  boring: BoringAggregateResult,
  groovesByPart: Map<string, GrooveFeature[]>,
): PanelManufacturingInput[] {
  const boresByPart = new Map(boring.panels.map((p) => [p.partPath, p.bores]));
  const bySig = new Map<string, PanelManufacturingInput>();

  for (const row of cutList.rows) {
    const bores = boresByPart.get(row.partPath) ?? [];
    const grooves = groovesByPart.get(row.partPath) ?? [];
    const sig = machiningSignature(row, bores, grooves);

    const existing = bySig.get(sig);
    if (existing) {
      existing.qty += row.qty;
      continue;
    }

    // Convert CutListEdgeBandCell (has materialName) → EdgeBand|null (no materialName)
    const edgeBands = {
      front: row.edgeBands.front
        ? { materialId: row.edgeBands.front.materialId, thickness: row.edgeBands.front.thickness }
        : null,
      back: row.edgeBands.back
        ? { materialId: row.edgeBands.back.materialId, thickness: row.edgeBands.back.thickness }
        : null,
      left: row.edgeBands.left
        ? { materialId: row.edgeBands.left.materialId, thickness: row.edgeBands.left.thickness }
        : null,
      right: row.edgeBands.right
        ? { materialId: row.edgeBands.right.materialId, thickness: row.edgeBands.right.thickness }
        : null,
    } as const;

    bySig.set(sig, {
      itemNumber: row.itemNumber,
      partName: row.partName,
      spec: {
        length: row.length,
        width: row.width,
        thickness: row.thickness,
        materialId: row.materialId,
        grain: row.grain,
        edgeBands,
      },
      materialName: row.materialName,
      bores,
      grooves,
      qty: row.qty,
    });
  }

  return [...bySig.values()];
}
