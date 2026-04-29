import type { AssemblyDocument, ComponentPath } from '@zilventor/shared';

export type SubAsmCacheLike = {
  get(p: string): { kind: 'ok'; doc: AssemblyDocument } | undefined;
};

/**
 * Walk an activeDoc tree along a multi-segment componentPath to find the
 * leaf component's partPath. Used by the solver-bridge to map a path-keyed
 * synthetic id back to its leaf .zipt for kernel ref resolution.
 *
 * Returns null if any intermediate segment is missing, or if a non-final
 * segment is not a .ziasm sub-assembly.
 */
export function resolveLeafPartPath(
  path: ComponentPath,
  activeDoc: AssemblyDocument,
  subAsmCache: SubAsmCacheLike,
): string | null {
  if (path.length === 0) return null;
  let cur: AssemblyDocument = activeDoc;
  for (let i = 0; i < path.length - 1; i++) {
    const c = cur.components.find((x) => x.id === path[i]);
    if (!c) return null;
    if (!c.partPath.endsWith('.ziasm')) return null;
    const e = subAsmCache.get(c.partPath);
    if (!e) return null;
    cur = e.doc;
  }
  const leaf = cur.components.find((x) => x.id === path[path.length - 1]);
  if (!leaf) return null;
  return leaf.partPath;
}
