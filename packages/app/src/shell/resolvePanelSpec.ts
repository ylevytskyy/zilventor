import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { isPanelFeature, resolvePanelSpecFromFeature, type PanelFeature, type PanelSpec } from '@zilventor/shared/src/panel-feature';
import type { SketchParameter } from '@zilventor/shared';

export type PanelSpecCache = Map<string, PanelSpec | null>;

type OpfsLike = { read: (path: string) => Promise<Uint8Array> };

export async function resolvePanelSpec(
  opfs: OpfsLike,
  partPath: string,
  cache: PanelSpecCache,
): Promise<PanelSpec | null> {
  if (cache.has(partPath)) return cache.get(partPath)!;
  try {
    const bytes = await opfs.read(partPath);
    const project = await unpackProject(bytes);
    const manifest = project.manifest as {
      document?: {
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
    cache.set(partPath, spec);
    return spec;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`panelSpec resolve failed for ${partPath}:`, err);
    cache.set(partPath, null);
    return null;
  }
}
