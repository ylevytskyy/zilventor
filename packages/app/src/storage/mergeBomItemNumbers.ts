import type { AssemblyDocument, PartInfo } from '@zilventor/shared';
import { pruneBomItemNumbers } from '@zilventor/shared/src/bomRow';
import { aggregateBomRecursive } from '../assembly/walkers/aggregateBomRecursive';
import type { SubAssemblyCache } from '../assembly/SubAssemblyCache';

export function mergeAndPruneBom(
  assembly: AssemblyDocument,
  partInfo: Map<string, PartInfo>,
  cache: Pick<SubAssemblyCache, 'get'>,
): AssemblyDocument {
  // Prune orphans first so their stale item numbers don't pollute the
  // next-number computation in aggregateBomRecursive.
  const pruned = { ...assembly, bomItemNumbers: pruneBomItemNumbers(assembly) };
  const rows = aggregateBomRecursive(pruned, cache, partInfo);
  const merged = { ...pruned.bomItemNumbers };
  for (const r of rows) merged[r.rowKey] = r.itemNumber;
  return { ...pruned, bomItemNumbers: merged };
}
