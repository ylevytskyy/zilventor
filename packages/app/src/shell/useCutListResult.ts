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
  const { panelSpecCacheRef, partInfoCacheRef, diagnosticsCacheRef, partInfoVersion, geometryReadyTick } = useCutListCacheContext();

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
    // geometryReadyTick: same reasoning for panelSpecCacheRef, populated by
    // the assembly mesh-sync effect (not the partInfo-resolve effect that
    // bumps partInfoVersion). Without this dep, a component that mounts
    // before that effect's first pass completes (e.g. the Furniture tab
    // opened right after cabinet creation) permanently sees rows=[] for any
    // panel resolved only after mount, until something else bumps
    // activeAssembly/subAssemblyDocs identity.
  }, [activeAssembly, subAssemblyDocs, panelSpecCacheRef, partInfoCacheRef, diagnosticsCacheRef, partInfoVersion, geometryReadyTick]);
}
