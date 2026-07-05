import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { aggregateBoresRecursive, type BoringAggregateResult } from '../assembly/walkers/aggregateBoresRecursive';
import { useCutListCacheContext } from './CutListCacheContext';
import type { BoreOp } from '@zilventor/shared';

const EMPTY: BoringAggregateResult = { panels: [] };

export function useBoringResult(): BoringAggregateResult {
  const activeAssembly = useAppStore((s) => s.activeAssembly);
  const subAssemblyDocs = useAppStore((s) => s.subAssemblyDocs);
  const { partBoresCacheRef, partInfoCacheRef, panelSpecCacheRef, geometryReadyTick } = useCutListCacheContext();

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
    // geometryReadyTick: bumped by the assembly mesh-sync effect after it
    // finishes repopulating partBoresCacheRef from OPFS. Without this dep, the
    // memo above stays stuck at whatever it saw at eviction time (usually 0
    // bores) until something else bumps activeAssembly/subAssemblyDocs
    // identity — e.g. opening the Cut List tab — instead of recomputing as
    // soon as the real bores actually land.
  }, [activeAssembly, subAssemblyDocs, partBoresCacheRef, partInfoCacheRef, panelSpecCacheRef, geometryReadyTick]);
}
