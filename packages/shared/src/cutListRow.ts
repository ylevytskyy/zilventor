import type { GrainDirection, PanelSpec, PanelEdgeKey } from './panel-feature';
import type { MaterialId, MaterialRegistry } from './material';
import type { ComponentInstance } from './types';
import type { PanelPreflightDiagnostic } from './panel-preflight';

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
  | { materialId: MaterialId; materialName: string; thickness: number }
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
  oversize?: { lengthMm: number; widthMm: number };
};

/** Cut (raw) length = finished length + length oversize allowance (0 if absent). */
export function rawLength(row: CutListRow): number {
  return row.length + (row.oversize?.lengthMm ?? 0);
}

/** Cut (raw) width = finished width + width oversize allowance (0 if absent). */
export function rawWidth(row: CutListRow): number {
  return row.width + (row.oversize?.widthMm ?? 0);
}

/**
 * Gross length = finished length + thickness of the two bands that run across the
 * width (left/right edges). Mirrors the front/back↔length, left/right↔width edge
 * convention used by the band-length rollup below.
 */
export function grossLength(row: CutListRow): number {
  return row.length + (row.edgeBands.left?.thickness ?? 0) + (row.edgeBands.right?.thickness ?? 0);
}

/** Gross width = finished width + thickness of the front/back bands (run along length). */
export function grossWidth(row: CutListRow): number {
  return row.width + (row.edgeBands.front?.thickness ?? 0) + (row.edgeBands.back?.thickness ?? 0);
}

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
  /** R1 preflight diagnostics collected upstream (resolvePanelSpec) and threaded
   *  through by the caller. Absent-not-empty: omitted when there are none. */
  diagnostics?: PanelPreflightDiagnostic[];
};

type GroupAcc = {
  spec: PanelSpec;
  normalized: { L: number; W: number };
  componentIds: string[];
  partPath: string;
};

function resolveMaterialName(id: MaterialId, materials: MaterialRegistry): string {
  const found = materials.find((m) => m.id === id);
  return found ? found.name : '(missing material)';
}

function makeBandCell(
  band: { materialId: MaterialId; thickness: number } | null,
  materials: MaterialRegistry,
): CutListEdgeBandCell {
  if (!band) return null;
  return {
    materialId: band.materialId,
    materialName: resolveMaterialName(band.materialId, materials),
    thickness: band.thickness,
  };
}

export function aggregateCutListLocal(
  assembly: { components: ComponentInstance[]; cutListItemNumbers: Record<string, number> },
  panelSpecs: Map<string, PanelSpec | null>,
  materials: MaterialRegistry,
  partNames: Map<string, string> = new Map(),
): CutListResult {
  const groups = new Map<string, GroupAcc>();
  let nonPanelComponentCount = 0;
  const nonPanelPaths = new Set<string>();

  for (const c of assembly.components) {
    const spec = panelSpecs.get(c.partPath);
    if (!spec) {
      nonPanelComponentCount++;
      nonPanelPaths.add(c.partPath);
      continue;
    }
    const normalized = normalizeLW(spec);
    const key = cutListRowKey(spec, normalized);
    const existing = groups.get(key);
    if (existing) {
      existing.componentIds.push(c.id);
    } else {
      groups.set(key, { spec, normalized, componentIds: [c.id], partPath: c.partPath });
    }
  }

  const stored = assembly.cutListItemNumbers;
  const usedNumbers = new Set(Object.values(stored));
  let nextNumber = (usedNumbers.size === 0 ? 0 : Math.max(...usedNumbers)) + 1;

  const rows: CutListRow[] = [];
  for (const [key, g] of groups) {
    let itemNumber = stored[key];
    if (itemNumber === undefined) itemNumber = nextNumber++;
    rows.push({
      rowKey: key,
      itemNumber,
      qty: g.componentIds.length,
      length: g.normalized.L,
      width: g.normalized.W,
      thickness: g.spec.thickness,
      materialId: g.spec.materialId,
      materialName: resolveMaterialName(g.spec.materialId, materials),
      grain: g.spec.grain,
      edgeBands: {
        front: makeBandCell(g.spec.edgeBands.front, materials),
        back: makeBandCell(g.spec.edgeBands.back, materials),
        left: makeBandCell(g.spec.edgeBands.left, materials),
        right: makeBandCell(g.spec.edgeBands.right, materials),
      },
      partPath: g.partPath,
      partName: partNames.get(g.partPath) ?? '(missing part)',
      componentPathKeys: [...g.componentIds],
    });
  }
  rows.sort((a, b) => a.itemNumber - b.itemNumber);

  const bandAcc = new Map<MaterialId, { name: string; total: number }>();
  for (const r of rows) {
    for (const edgeKey of ['front', 'back', 'left', 'right'] as const) {
      const cell = r.edgeBands[edgeKey];
      if (!cell) continue;
      const perEdgeLen = edgeKey === 'front' || edgeKey === 'back' ? r.length : r.width;
      const acc = bandAcc.get(cell.materialId);
      if (acc) acc.total += perEdgeLen * r.qty;
      else bandAcc.set(cell.materialId, { name: cell.materialName, total: perEdgeLen * r.qty });
    }
  }
  const bandTotals: EdgeBandTotal[] = Array.from(bandAcc.entries()).map(([materialId, v]) => ({
    materialId,
    materialName: v.name,
    totalLengthMm: v.total,
  }));
  bandTotals.sort((a, b) => a.materialName.localeCompare(b.materialName));

  return {
    rows,
    bandTotals,
    excluded: { componentCount: nonPanelComponentCount, partCount: nonPanelPaths.size },
  };
}

export function compareCutListRowsForRenumber(a: CutListRow, b: CutListRow): number {
  if (a.materialName !== b.materialName) return a.materialName.localeCompare(b.materialName);
  if (a.length !== b.length) return b.length - a.length;
  if (a.width !== b.width) return b.width - a.width;
  if (a.rowKey !== b.rowKey) return a.rowKey < b.rowKey ? -1 : 1;
  return 0;
}

export function pruneCutListItemNumbers(
  liveKeys: readonly string[],
  stored: Record<string, number>,
): Record<string, number> {
  const live = new Set(liveKeys);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(stored)) {
    if (live.has(k)) out[k] = v;
  }
  return out;
}
