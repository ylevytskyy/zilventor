import { resolvePanelSpec, type PanelSpecCache } from './resolvePanelSpec';
import type { PanelSpec } from '@zilventor/shared/src/panel-feature';

type OpfsLike = { read: (path: string) => Promise<Uint8Array> };

export async function loadCutListInputs(
  opfs: OpfsLike,
  leafPartPaths: readonly string[],
  cache: PanelSpecCache,
): Promise<Map<string, PanelSpec | null>> {
  const unique = Array.from(new Set(leafPartPaths));
  const results = await Promise.all(unique.map((p) => resolvePanelSpec(opfs, p, cache)));
  const out = new Map<string, PanelSpec | null>();
  unique.forEach((p, i) => out.set(p, results[i] ?? null));
  return out;
}
