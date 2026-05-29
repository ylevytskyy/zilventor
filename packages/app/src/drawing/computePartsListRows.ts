// packages/app/src/drawing/computePartsListRows.ts
// Computes PartsListRow[] from an assembly + walkers + caches (app-level module).
import type { AssemblyDocument, PartInfo } from '@zilventor/shared';
import type { PartsListRow } from '@zilventor/shared/src/drawing/types';
import type { PanelSpec } from '@zilventor/shared/src/panel-feature';
import { aggregateBomRecursive } from '../assembly/walkers/aggregateBomRecursive';

type SubAsmCacheLike = { get: (p: string) => { kind: 'ok'; doc: AssemblyDocument; partPath: string } | undefined };

const EDGE_LABELS: Record<string, string> = {
  front: 'F',
  back: 'B',
  left: 'L',
  right: 'R',
};

function edgeBandsString(spec: PanelSpec): string {
  const labels: string[] = [];
  for (const key of ['front', 'back', 'left', 'right'] as const) {
    if (spec.edgeBands[key]) {
      labels.push(EDGE_LABELS[key]!);
    }
  }
  return labels.join(',');
}

/**
 * Derives a PartsListRow snapshot for each BOM row of the assembly.
 * Panels get material + dimension info from panelSpecs; hardware rows (not in panelSpecs) get ''.
 *
 * Part-source fallback: if asmDoc is not provided (null), returns [].
 */
export function computePartsListRows(
  asmDoc: AssemblyDocument,
  subAsmCache: SubAsmCacheLike,
  panelSpecs: Map<string, PanelSpec | null>,
  partInfo: Map<string, PartInfo>,
): PartsListRow[] {
  // aggregateBomRecursive handles recursive sub-assemblies, item numbering, qty grouping.
  const bomRows = aggregateBomRecursive(asmDoc, subAsmCache, partInfo);

  return bomRows.map((row, idx) => {
    const spec = panelSpecs.get(row.partPath) ?? null;
    const item = row.itemNumber > 0 ? row.itemNumber : idx + 1;

    if (!spec) {
      // Hardware / cold-cache: BOM-only row
      return {
        item,
        qty: row.qty,
        partName: row.partName,
        material: '',
        dimensions: '',
        edgeBands: '',
      };
    }

    // Resolve material name from assembly materials registry
    const matEntry = asmDoc.materials.find((m) => m.id === spec.materialId);
    const materialName = matEntry?.name ?? spec.materialId;

    const dimensions = `${spec.length}×${spec.width}×${spec.thickness}`;

    return {
      item,
      qty: row.qty,
      partName: row.partName,
      material: materialName,
      dimensions,
      edgeBands: edgeBandsString(spec),
    };
  });
}
