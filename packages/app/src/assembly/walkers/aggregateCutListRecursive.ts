import type { AssemblyDocument, PartInfo, PanelPreflightDiagnostic } from '@zilventor/shared';
import type { MaterialRegistry, MaterialId } from '@zilventor/shared/src/material';
import type { PanelSpec } from '@zilventor/shared/src/panel-feature';
import {
  cutListRowKey, normalizeLW,
  type CutListEdgeBandCell, type CutListResult, type CutListRow, type EdgeBandTotal,
} from '@zilventor/shared/src/cutListRow';
import { pathKey } from '@zilventor/shared';
import type { SubAssemblyCache } from '../SubAssemblyCache';

type GroupAcc = {
  spec: PanelSpec;
  normalized: { L: number; W: number };
  componentPathKeys: string[];
  partPath: string;
  /** Parallel to componentPathKeys — the part name of EACH physical component
   *  folded into this group, even when their partPaths differ (see
   *  CutListRow.partNames doc comment). */
  partNames: string[];
};

function materialName(id: MaterialId, materials: MaterialRegistry): string {
  return materials.find((m) => m.id === id)?.name ?? '(missing material)';
}

function bandCell(b: { materialId: MaterialId; thickness: number } | null, materials: MaterialRegistry): CutListEdgeBandCell {
  return b ? { materialId: b.materialId, materialName: materialName(b.materialId, materials), thickness: b.thickness } : null;
}

export function aggregateCutListRecursive(
  activeDoc: AssemblyDocument,
  cache: Pick<SubAssemblyCache, 'get'>,
  panelSpecs: Map<string, PanelSpec | null>,
  materials: MaterialRegistry,
  partInfo: Map<string, PartInfo>,
  /** R1 preflight diagnostics collected upstream (resolvePanelSpec via
   *  loadCutListInputs) — threaded through onto the result unchanged. */
  diagnostics?: PanelPreflightDiagnostic[],
): CutListResult {
  const groups = new Map<string, GroupAcc>();
  let nonPanelComponentCount = 0;
  const nonPanelPaths = new Set<string>();

  function walk(doc: AssemblyDocument, prefix: string[]): void {
    for (const c of doc.components) {
      const path = [...prefix, c.id];
      if (c.partPath.endsWith('.ziasm')) {
        const e = cache.get(c.partPath);
        if (e && e.kind === 'ok') walk(e.doc, path);
        continue;
      }
      const spec = panelSpecs.get(c.partPath);
      if (!spec) {
        nonPanelComponentCount++;
        nonPanelPaths.add(c.partPath);
        continue;
      }
      const normalized = normalizeLW(spec);
      const key = cutListRowKey(spec, normalized);
      const name = partInfo.get(c.partPath)?.name ?? '(missing part)';
      const existing = groups.get(key);
      if (existing) {
        existing.componentPathKeys.push(pathKey(path));
        existing.partNames.push(name);
      } else {
        groups.set(key, {
          spec, normalized,
          componentPathKeys: [pathKey(path)],
          partPath: c.partPath,
          partNames: [name],
        });
      }
    }
  }
  walk(activeDoc, []);

  const stored = activeDoc.cutListItemNumbers;
  const used = new Set(Object.values(stored));
  let nextNumber = (used.size === 0 ? 0 : Math.max(...used)) + 1;

  const rows: CutListRow[] = [];
  for (const [key, g] of groups) {
    let n = stored[key];
    if (n === undefined) n = nextNumber++;
    const info = partInfo.get(g.partPath);
    rows.push({
      rowKey: key,
      itemNumber: n,
      qty: g.componentPathKeys.length,
      length: g.normalized.L,
      width: g.normalized.W,
      thickness: g.spec.thickness,
      materialId: g.spec.materialId,
      materialName: materialName(g.spec.materialId, materials),
      grain: g.spec.grain,
      edgeBands: {
        front: bandCell(g.spec.edgeBands.front, materials),
        back: bandCell(g.spec.edgeBands.back, materials),
        left: bandCell(g.spec.edgeBands.left, materials),
        right: bandCell(g.spec.edgeBands.right, materials),
      },
      partPath: g.partPath,
      partName: info?.name ?? '(missing part)',
      componentPathKeys: [...g.componentPathKeys],
      partNames: [...g.partNames],
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
    materialId, materialName: v.name, totalLengthMm: v.total,
  }));
  bandTotals.sort((a, b) => a.materialName.localeCompare(b.materialName));

  const excluded = { componentCount: nonPanelComponentCount, partCount: nonPanelPaths.size };
  return diagnostics && diagnostics.length > 0
    ? { rows, bandTotals, excluded, diagnostics }
    : { rows, bandTotals, excluded };
}
