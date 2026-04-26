import type { AssemblyDocument } from '@zilventor/shared';
import { aggregateBom, pruneBomItemNumbers } from '@zilventor/shared/src/bomRow';

export function mergeAndPruneBom(assembly: AssemblyDocument, partNames: Map<string, string>): AssemblyDocument {
  // Prune orphans first so their stale item numbers don't pollute the
  // next-number computation in aggregateBom.
  const pruned = { ...assembly, bomItemNumbers: pruneBomItemNumbers(assembly) };
  const rows = aggregateBom(pruned, partNames);
  const merged = { ...pruned.bomItemNumbers };
  for (const r of rows) merged[r.rowKey] = r.itemNumber;
  return { ...pruned, bomItemNumbers: merged };
}
