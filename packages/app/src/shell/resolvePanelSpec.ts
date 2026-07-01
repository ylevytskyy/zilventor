import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { isPanelFeature, resolvePanelSpecFromFeature, type PanelFeature, type PanelSpec } from '@zilventor/shared/src/panel-feature';
import { panelPreflight, type SketchParameter, type PanelPreflightDiagnostic } from '@zilventor/shared';

export type PanelSpecCache = Map<string, PanelSpec | null>;

type OpfsLike = { read: (path: string) => Promise<Uint8Array> };

export async function resolvePanelSpec(
  opfs: OpfsLike,
  partPath: string,
  cache: PanelSpecCache,
  /** Optional out-param: R1 preflight failures are pushed here in addition
   *  to the existing console.warn, so batch callers (loadCutListInputs) can
   *  collect them without changing this function's return type. */
  diagnostics?: PanelPreflightDiagnostic[],
): Promise<PanelSpec | null> {
  if (cache.has(partPath)) return cache.get(partPath)!;
  try {
    const bytes = await opfs.read(partPath);
    const project = await unpackProject(bytes);
    const manifest = project.manifest as {
      document?: {
        name?: string;
        featureTree?: unknown[];
        parameters?: Record<string, SketchParameter>;
      };
    } | null;
    const tree = manifest?.document?.featureTree ?? [];
    const panel = (tree as unknown[]).find((f): f is PanelFeature => isPanelFeature(f));
    if (!panel) {
      cache.set(partPath, null);
      return null;
    }
    const params = manifest?.document?.parameters ?? {};
    const spec = resolvePanelSpecFromFeature(panel, params);
    if (!spec) {
      cache.set(partPath, null);
      return null;
    }
    // R1 preflight: parametric parts (built via PanelFeature) are single-solid
    // and manifold by kernel construction — only name/material can be missing.
    const preflight = panelPreflight({ name: manifest?.document?.name, materialId: spec.materialId, solidCount: 1 });
    if (preflight.kind !== 'pass') {
      console.warn(`panelPreflight ${preflight.kind} for ${partPath}: ${preflight.reasonKey}`);
      diagnostics?.push({ partPath, reasonKey: preflight.reasonKey, params: { name: manifest?.document?.name } });
      cache.set(partPath, null);
      return null;
    }
    cache.set(partPath, spec);
    return spec;
  } catch (err) {
     
    console.warn(`panelSpec resolve failed for ${partPath}:`, err);
    cache.set(partPath, null);
    return null;
  }
}
