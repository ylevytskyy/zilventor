import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { aggregateBoresRecursive, type BoringAggregateResult } from '../assembly/walkers/aggregateBoresRecursive';
import { useCutListCacheContext } from './CutListCacheContext';
import type { BoreOp } from '@zilventor/shared';

const EMPTY: BoringAggregateResult = { panels: [] };

export function useBoringResult(): BoringAggregateResult {
  const activeAssembly = useAppStore((s) => s.activeAssembly);
  const subAssemblyDocs = useAppStore((s) => s.subAssemblyDocs);
  const { partBoresCacheRef, partInfoCacheRef, panelSpecCacheRef } = useCutListCacheContext();

  return useMemo(() => {
    if (!activeAssembly) return EMPTY;
    const subAsmCacheAdapter = {
      get: (p: string) =>
        subAssemblyDocs[p]
          ? { kind: 'ok' as const, doc: subAssemblyDocs[p]!, partPath: p }
          : undefined,
    };
    // Build a bores map containing only parts that actually have bores.
    const boresCache = new Map<string, BoreOp[]>();
    for (const [k, v] of (partBoresCacheRef.current ?? new Map()).entries()) {
      if (v && v.length > 0) boresCache.set(k, v);
    }
    return aggregateBoresRecursive(
      activeAssembly,
      subAsmCacheAdapter,
      boresCache,
      partInfoCacheRef.current ?? new Map(),
      panelSpecCacheRef.current ?? new Map(),
    );
  }, [activeAssembly, subAssemblyDocs, partBoresCacheRef, partInfoCacheRef, panelSpecCacheRef]);
}
