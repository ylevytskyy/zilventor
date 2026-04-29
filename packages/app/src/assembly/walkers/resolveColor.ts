import type { AssemblyDocument, ComponentColor, ComponentInstance, ComponentPath } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import type { SubAssemblyCache } from '../SubAssemblyCache';

export function resolveColor(
  path: ComponentPath,
  activeDoc: AssemblyDocument,
  cache: Pick<SubAssemblyCache, 'get'>,
): ComponentColor | undefined {
  const exactOverride = activeDoc.colorOverrides[pathKey(path)];
  if (exactOverride) return exactOverride;
  let cur: AssemblyDocument | undefined = activeDoc;
  let last: ComponentColor | undefined;
  for (let i = 0; i < path.length; i++) {
    if (!cur) return last;
    const c: ComponentInstance | undefined = cur.components.find((x) => x.id === path[i]);
    if (!c) return last;
    if (c.color) last = c.color;
    if (i === path.length - 1) return last;
    if (!c.partPath.endsWith('.ziasm')) return last;
    const e = cache.get(c.partPath);
    cur = e && e.kind === 'ok' ? e.doc : undefined;
  }
  return last;
}
