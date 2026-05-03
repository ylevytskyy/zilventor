import type { GrainDirection, PanelSpec, PanelEdgeKey } from './panel-feature';
import type { MaterialId } from './material';

export function normalizeLW(spec: PanelSpec): { L: number; W: number } {
  if (spec.grain !== 'none') return { L: spec.length, W: spec.width };
  return { L: Math.max(spec.length, spec.width), W: Math.min(spec.length, spec.width) };
}

export function cutListRowKey(spec: PanelSpec, normalized: { L: number; W: number }): string {
  return [
    `L=${normalized.L}`,
    `W=${normalized.W}`,
    `T=${spec.thickness}`,
    `M=${spec.materialId}`,
    `G=${spec.grain}`,
  ].join('|');
}

export type CutListEdgeBandCell =
  | { materialId: MaterialId; materialName: string }
  | null;

export type CutListRow = {
  rowKey: string;
  itemNumber: number;
  qty: number;
  length: number;
  width: number;
  thickness: number;
  materialId: MaterialId;
  materialName: string;
  grain: GrainDirection;
  edgeBands: { [K in PanelEdgeKey]: CutListEdgeBandCell };
  partPath: string;
  partName: string;
  componentPathKeys: string[];
};

export type EdgeBandTotal = {
  materialId: MaterialId;
  materialName: string;
  totalLengthMm: number;
};

export type CutListExclusion = {
  componentCount: number;
  partCount: number;
};

export type CutListResult = {
  rows: CutListRow[];
  bandTotals: EdgeBandTotal[];
  excluded: CutListExclusion;
};
