import { resolvePanelSpec, type PanelSpecCache } from './resolvePanelSpec';
import type { PanelSpec } from '@zilventor/shared/src/panel-feature';
import type { PanelPreflightDiagnostic } from '@zilventor/shared';

type OpfsLike = { read: (path: string) => Promise<Uint8Array> };

export async function loadCutListInputs(
  opfs: OpfsLike,
  leafPartPaths: readonly string[],
  cache: PanelSpecCache,
  /** Optional out-param: R1 preflight failures across the whole batch are
   *  pushed here (forwarded to each resolvePanelSpec call). */
  diagnostics?: PanelPreflightDiagnostic[],
): Promise<Map<string, PanelSpec | null>> {
  const unique = Array.from(new Set(leafPartPaths));
  const results = await Promise.all(unique.map((p) => resolvePanelSpec(opfs, p, cache, diagnostics)));
  const out = new Map<string, PanelSpec | null>();
  unique.forEach((p, i) => out.set(p, results[i] ?? null));
  return out;
}
