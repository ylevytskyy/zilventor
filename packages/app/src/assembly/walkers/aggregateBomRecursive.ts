import type { AssemblyDocument, ComponentColor } from '@zilventor/shared';
import { bomRowKey, type BomRow } from '@zilventor/shared/src/bomRow';
import { pathKey } from '@zilventor/shared';
import type { SubAssemblyCache } from '../SubAssemblyCache';
import { resolveColor } from './resolveColor';

export function aggregateBomRecursive(
  activeDoc: AssemblyDocument,
  cache: Pick<SubAssemblyCache, 'get'>,
  partNames: Map<string, string>,
): BomRow[] {
  const groups = new Map<string, { partPath: string; color: ComponentColor | undefined; componentIds: string[] }>();
  function effective(p: string[]): ComponentColor | undefined {
    const c = resolveColor(p, activeDoc, cache);
    if (!c) return undefined;
    if (c.kind === 'palette' && !(c.name in activeDoc.colors)) return undefined;
    return c;
  }
  function walk(doc: AssemblyDocument, prefix: string[]) {
    for (const c of doc.components) {
      const path = [...prefix, c.id];
      if (!c.partPath.endsWith('.ziasm')) {
        const color = effective(path);
        const key = bomRowKey(c.partPath, color);
        const g = groups.get(key);
        if (g) g.componentIds.push(pathKey(path));
        else groups.set(key, { partPath: c.partPath, color, componentIds: [pathKey(path)] });
      } else {
        const e = cache.get(c.partPath);
        if (e && e.kind === 'ok') walk(e.doc, path);
      }
    }
  }
  walk(activeDoc, []);
  const existing = activeDoc.bomItemNumbers;
  const used = new Set(Object.values(existing));
  let nextNumber = (used.size === 0 ? 0 : Math.max(...used)) + 1;
  const rows: BomRow[] = [];
  for (const [rowKey, g] of groups) {
    let n = existing[rowKey];
    if (n === undefined) n = nextNumber++;
    rows.push({ rowKey, itemNumber: n, qty: g.componentIds.length, partPath: g.partPath,
      partName: partNames.get(g.partPath) ?? '(missing part)', color: g.color, componentIds: [...g.componentIds] });
  }
  rows.sort((a, b) => a.itemNumber - b.itemNumber);
  return rows;
}
