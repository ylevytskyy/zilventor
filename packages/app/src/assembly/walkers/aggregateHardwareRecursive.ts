import type { AssemblyDocument } from '@zilventor/shared';
import type { HardwareCategory, HardwareRegistry } from '@zilventor/shared';
import { isHardwareFeature } from '@zilventor/shared';

export interface HardwareRow {
  skuId: string;
  name: string;
  category: HardwareCategory;
  qty: number;
  notes: string;
}

export interface HardwareAggregateResult {
  rows: HardwareRow[];
}

type PartLike = { kind: 'part'; document: { featureTree: unknown[] } };
type CacheEntry = { kind: 'ok'; doc: AssemblyDocument } | PartLike;
type DocumentCache = Map<string, CacheEntry>;

export function aggregateHardwareRecursive(
  activeDoc: AssemblyDocument,
  cache: DocumentCache,
  hardwareRegistry: HardwareRegistry,
): HardwareAggregateResult {
  const acc = new Map<string, HardwareRow>();

  function walk(doc: AssemblyDocument): void {
    for (const c of doc.components) {
      if (c.partPath.endsWith('.ziasm')) {
        const entry = cache.get(c.partPath);
        if (entry && entry.kind === 'ok') walk(entry.doc);
        continue;
      }
      const entry = cache.get(c.partPath);
      if (!entry || entry.kind !== 'part') continue;
      const hwFeature = (entry.document.featureTree as unknown[]).find(isHardwareFeature);
      if (!hwFeature) continue;
      const regEntry = hardwareRegistry.find((e) => e.id === hwFeature.hardwareSkuId);
      if (!regEntry) continue;
      const existing = acc.get(regEntry.id);
      if (existing) {
        existing.qty += 1;
      } else {
        acc.set(regEntry.id, {
          skuId: regEntry.id,
          name: regEntry.name,
          category: regEntry.category,
          qty: 1,
          notes: regEntry.notes,
        });
      }
    }
  }

  walk(activeDoc);

  const rows = [...acc.values()].sort((a, b) => {
    if (a.category !== b.category) return a.category < b.category ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  return { rows };
}
