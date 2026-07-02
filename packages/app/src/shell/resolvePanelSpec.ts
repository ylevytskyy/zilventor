import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { isPanelFeature, resolvePanelSpecFromFeature, type PanelFeature, type PanelSpec } from '@zilventor/shared/src/panel-feature';
import { panelPreflight, type SketchParameter, type PanelPreflightDiagnostic, type ImportedFeature } from '@zilventor/shared';

function findImportedFeature(tree: unknown[]): ImportedFeature | undefined {
  return tree.find(
    (f): f is ImportedFeature => !!f && typeof f === 'object' && (f as { kind?: unknown }).kind === 'imported',
  );
}

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
      // R1 preflight for imported (non-panel) parts: source a real solidCount/
      // isManifold from the persisted ImportedFeature instead of silently
      // returning null with zero diagnostic. materialId is deliberately left
      // undefined — this branch only acts on the two outcomes reachable before
      // panelPreflight's name/material checks (split-required, notManifold);
      // a plain single-solid manifold import (e.g. hardware) must NOT be
      // flagged for a missing material it was never expected to carry.
      const imported = findImportedFeature(tree as unknown[]);
      if (imported) {
        const preflight = panelPreflight({
          name: manifest?.document?.name,
          materialId: undefined,
          solidCount: imported.solidColors?.length ?? 1,
          ...(imported.isManifold !== undefined ? { isManifold: imported.isManifold } : {}),
        });
        if (preflight.kind === 'split-required' || (preflight.kind === 'fail' && preflight.reasonKey === 'panel.preflight.notManifold')) {
          console.warn(`panelPreflight ${preflight.kind} for ${partPath}: ${preflight.reasonKey}`);
          const params = preflight.kind === 'split-required'
            ? { name: manifest?.document?.name, solidCount: preflight.solidCount }
            : { name: manifest?.document?.name };
          diagnostics?.push({ partPath, reasonKey: preflight.reasonKey, params });
        }
      }
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
