import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { aggregateCutListRecursive } from '../assembly/walkers/aggregateCutListRecursive';
import { useCutListCacheContext } from './CutListCacheContext';
import type { CutListResult } from '@zilventor/shared/src/cutListRow';

const EMPTY_RESULT: CutListResult = {
  rows: [],
  bandTotals: [],
  excluded: { componentCount: 0, partCount: 0 },
};

export function useCutListResult(): CutListResult {
  const activeAssembly = useAppStore((s) => s.activeAssembly);
  const subAssemblyDocs = useAppStore((s) => s.subAssemblyDocs);
  const { panelSpecCacheRef, partInfoCacheRef, diagnosticsCacheRef, partInfoVersion } = useCutListCacheContext();

  return useMemo(() => {
    if (!activeAssembly) return EMPTY_RESULT;

    const subAsmCacheAdapter = {
      get: (p: string) =>
        subAssemblyDocs[p]
          ? { kind: 'ok' as const, doc: subAssemblyDocs[p]!, partPath: p }
          : undefined,
    };

    return aggregateCutListRecursive(
      activeAssembly,
      subAsmCacheAdapter,
      panelSpecCacheRef.current ?? new Map(),
      activeAssembly.materials ?? [],
      partInfoCacheRef.current ?? new Map(),
      diagnosticsCacheRef.current ?? [],
    );
    // partInfoVersion is a dep even though it isn't read in the body above:
    // partInfoCacheRef is a stable ref (its identity never changes), so
    // without this the memo wouldn't recompute after a resolvePartInfo
    // pass completes and populates the cache in place.
  }, [activeAssembly, subAssemblyDocs, panelSpecCacheRef, partInfoCacheRef, diagnosticsCacheRef, partInfoVersion]);
}
