import type { AssemblyDocument } from '@zilventor/shared';
import { pruneCutListItemNumbers, type CutListResult } from '@zilventor/shared/src/cutListRow';

export function mergeAndPruneCutList(
  assembly: AssemblyDocument,
  result: CutListResult,
  opts: { cacheComplete: boolean },
): AssemblyDocument {
  const merged: Record<string, number> = { ...assembly.cutListItemNumbers };
  for (const r of result.rows) merged[r.rowKey] = r.itemNumber;
  const cutListItemNumbers = opts.cacheComplete
    ? pruneCutListItemNumbers(result.rows.map((r) => r.rowKey), merged)
    : merged;
  return { ...assembly, cutListItemNumbers };
}
