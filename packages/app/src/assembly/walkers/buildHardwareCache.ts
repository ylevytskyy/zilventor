import type { AssemblyDocument } from '@zilventor/shared';
import { resolveHardwareCatalog } from '@zilventor/shared/src/hardware/resolveCatalog';

type CacheEntry =
  | { kind: 'ok'; doc: AssemblyDocument }
  | { kind: 'part'; document: { featureTree: unknown[] } };

export function buildHardwareCache(
  activeDoc: AssemblyDocument,
  subAssemblyDocs: Record<string, AssemblyDocument>,
): Map<string, CacheEntry> {
  const cache = new Map<string, CacheEntry>();

  // Seed sub-assembly 'ok' entries.
  for (const [path, doc] of Object.entries(subAssemblyDocs)) {
    cache.set(path, { kind: 'ok', doc });
  }

  // Walk all components (root + sub-assemblies) to find hardware paths.
  function walkComponents(doc: AssemblyDocument): void {
    for (const c of doc.components) {
      if (c.partPath.endsWith('.ziasm')) {
        const subDoc = subAssemblyDocs[c.partPath];
        if (subDoc) walkComponents(subDoc);
        continue;
      }
      if (c.partPath.startsWith('hardware/') && c.partPath.endsWith('.zipt')) {
        if (cache.has(c.partPath)) continue; // already synthesized
        const skuId = c.partPath.slice('hardware/'.length, -'.zipt'.length);
        const entry = resolveHardwareCatalog(activeDoc).find((e) => e.id === skuId);
        if (!entry) continue; // unknown SKU — skip gracefully
        cache.set(c.partPath, {
          kind: 'part',
          document: {
            featureTree: [
              {
                kind: 'hardware',
                id: `hf-${entry.id}`,
                hardwareSkuId: entry.id,
                bboxMm: entry.bboxMm,
                attachPoints: entry.attachPoints,
              },
            ],
          },
        });
      }
    }
  }

  walkComponents(activeDoc);

  return cache;
}
