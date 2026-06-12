import type { AssemblyDocument, ComponentColor, ComponentPath } from '@zilventor/shared';
import type { SubAssemblyCache } from '../SubAssemblyCache';
import { resolveColor } from './resolveColor';

export type VisibleLeaf = {
  kind: 'leaf' | 'placeholder';
  componentPath: ComponentPath;
  partPath: string;
  effectiveColor: ComponentColor | undefined;
  /** Furniture role from ComponentInstance.role — used for carcass-noise filter (C1). */
  role?: string;
};

export function visibleLeaves(
  activeDoc: AssemblyDocument,
  cache: Pick<SubAssemblyCache, 'get'>,
): VisibleLeaf[] {
  const out: VisibleLeaf[] = [];
  function walk(doc: AssemblyDocument, prefix: string[], visible: boolean, stack: Set<string>) {
    for (const c of doc.components) {
      const path = [...prefix, c.id];
      const v = visible && c.visible;
      if (!v) continue;
      if (!c.partPath.endsWith('.ziasm')) {
        out.push({
          kind: 'leaf',
          componentPath: path,
          partPath: c.partPath,
          effectiveColor: resolveColor(path, activeDoc, cache),
          ...(c.role !== undefined ? { role: c.role } : {}),
        });
      } else {
        if (stack.has(c.partPath)) {
          out.push({ kind: 'placeholder', componentPath: path, partPath: c.partPath, effectiveColor: undefined });
          continue;
        }
        const e = cache.get(c.partPath);
        if (!e || e.kind !== 'ok') {
          out.push({ kind: 'placeholder', componentPath: path, partPath: c.partPath, effectiveColor: undefined });
        } else {
          const next = new Set(stack);
          next.add(c.partPath);
          walk(e.doc, path, v, next);
        }
      }
    }
  }
  walk(activeDoc, [], true, new Set());
  return out;
}
