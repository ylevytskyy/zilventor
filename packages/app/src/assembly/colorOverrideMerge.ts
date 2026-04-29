import type { AssemblyDocument } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import type { SubAssemblyCache } from './SubAssemblyCache';

function collectAllPaths(doc: AssemblyDocument, cache: Pick<SubAssemblyCache, 'get'>): Set<string> {
  const out = new Set<string>();
  function walk(d: AssemblyDocument, prefix: string[]) {
    for (const c of d.components) {
      const path = [...prefix, c.id];
      out.add(pathKey(path));
      if (c.partPath.endsWith('.ziasm')) {
        const e = cache.get(c.partPath);
        if (e && e.kind === 'ok') walk(e.doc, path);
      }
    }
  }
  walk(doc, []);
  return out;
}

export function mergeAndPruneColorOverrides(
  activeDoc: AssemblyDocument,
  cache: Pick<SubAssemblyCache, 'get'>,
): AssemblyDocument {
  const live = collectAllPaths(activeDoc, cache);
  const next: AssemblyDocument['colorOverrides'] = {};
  for (const [k, v] of Object.entries(activeDoc.colorOverrides)) {
    if (live.has(k)) next[k] = v;
  }
  return { ...activeDoc, colorOverrides: next };
}
