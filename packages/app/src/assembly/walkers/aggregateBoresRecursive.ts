import type { AssemblyDocument, BoreOp, PartInfo, PanelPreflightDiagnostic } from '@zilventor/shared';
import { pathKey, panelPreflight } from '@zilventor/shared';
import type { SubAssemblyCache } from '../SubAssemblyCache';
import type { PanelSpec } from '@zilventor/shared';

export interface BoringPanelGroup {
  partPath: string;
  partName: string;
  bores: BoreOp[];
  qty: number;
  componentPathKeys: string[];
  /** Real panel dimensions from PanelSpec; null when unresolvable. */
  length: number | null;
  width: number | null;
  thickness: number | null;
}

export interface BoringAggregateResult {
  panels: BoringPanelGroup[];
  /** Absent-not-empty: omitted when no panel failed preflight, never []. */
  diagnostics?: PanelPreflightDiagnostic[];
}

export function aggregateBoresRecursive(
  activeDoc: AssemblyDocument,
  cache: Pick<SubAssemblyCache, 'get'>,
  partBores: Map<string, BoreOp[]>,
  partInfo: Map<string, PartInfo>,
  panelSpecs?: Map<string, PanelSpec | null>,
): BoringAggregateResult {
  const groups = new Map<string, BoringPanelGroup>();
  const diagnostics: PanelPreflightDiagnostic[] = [];

  function walk(doc: AssemblyDocument, prefix: string[]): void {
    for (const c of doc.components) {
      const path = [...prefix, c.id];
      if (c.partPath.endsWith('.ziasm')) {
        const e = cache.get(c.partPath);
        if (e && e.kind === 'ok') walk(e.doc, path);
        continue;
      }
      const bores = partBores.get(c.partPath);
      if (!bores || bores.length === 0) continue;
      const existing = groups.get(c.partPath);
      if (existing) {
        existing.qty += 1;
        existing.componentPathKeys.push(pathKey(path));
      } else {
        const spec = panelSpecs?.get(c.partPath) ?? null;
        const partName = partInfo.get(c.partPath)?.name;
        // R1 preflight: a bored panel must resolve a name + material assignment
        // before boring/export. Named diagnostic instead of a silent null/skip;
        // the group is still returned (downstream null-field handling unchanged).
        const preflight = panelPreflight({ name: partName, materialId: spec?.materialId, solidCount: 1 });
        if (preflight.kind !== 'pass') {
          console.warn(`panelPreflight ${preflight.kind} for ${c.partPath}: ${preflight.reasonKey}`);
          const params = preflight.kind === 'split-required'
            ? { name: partName, solidCount: preflight.solidCount }
            : { name: partName };
          diagnostics.push({ partPath: c.partPath, reasonKey: preflight.reasonKey, params });
        }
        groups.set(c.partPath, {
          partPath: c.partPath,
          partName: partName ?? '(missing part)',
          bores: [...bores],
          qty: 1,
          componentPathKeys: [pathKey(path)],
          length: spec?.length ?? null,
          width: spec?.width ?? null,
          thickness: spec?.thickness ?? null,
        });
      }
    }
  }
  walk(activeDoc, []);

  const panels = Array.from(groups.values());
  panels.sort((a, b) => a.partPath.localeCompare(b.partPath));
  return diagnostics.length > 0 ? { panels, diagnostics } : { panels };
}
