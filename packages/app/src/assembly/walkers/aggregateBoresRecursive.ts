import type { AssemblyDocument, BoreOp, PartInfo } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import type { SubAssemblyCache } from '../SubAssemblyCache';

export interface BoringPanelGroup {
  partPath: string;
  partName: string;
  bores: BoreOp[];
  qty: number;
  componentPathKeys: string[];
}

export interface BoringAggregateResult {
  panels: BoringPanelGroup[];
}

export function aggregateBoresRecursive(
  activeDoc: AssemblyDocument,
  cache: Pick<SubAssemblyCache, 'get'>,
  partBores: Map<string, BoreOp[]>,
  partInfo: Map<string, PartInfo>,
): BoringAggregateResult {
  const groups = new Map<string, BoringPanelGroup>();

  function walk(doc: AssemblyDocument, prefix: string[]): void {
    for (const c of doc.components) {
      const path = [...prefix, c.id];
      if (c.partPath.endsWith('.ziasm')) {
        const e = cache.get(c.partPath);
        if (e && e.kind === 'ok') walk(e.doc, path);
        continue;
      }
      const bores = partBores.get(c.partPath);
      if (!bores || bores.length === 0) continue;
      const existing = groups.get(c.partPath);
      if (existing) {
        existing.qty += 1;
        existing.componentPathKeys.push(pathKey(path));
      } else {
        groups.set(c.partPath, {
          partPath: c.partPath,
          partName: partInfo.get(c.partPath)?.name ?? '(missing part)',
          bores: [...bores],
          qty: 1,
          componentPathKeys: [pathKey(path)],
        });
      }
    }
  }
  walk(activeDoc, []);

  const panels = Array.from(groups.values());
  panels.sort((a, b) => a.partPath.localeCompare(b.partPath));
  return { panels };
}
