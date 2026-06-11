import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/useAppStore';
import { aggregateConnectorBomRecursive } from '../assembly/walkers/aggregateConnectorBomRecursive';
import { useCutListCacheContext } from './CutListCacheContext';
import type { ConnectorBomRow } from './ConnectorBomTable';

const EMPTY: ConnectorBomRow[] = [];

export function useConnectorBomResult(): ConnectorBomRow[] {
  const { t } = useTranslation();
  const activeAssembly = useAppStore((s) => s.activeAssembly);
  const subAssemblyDocs = useAppStore((s) => s.subAssemblyDocs);
  const { partBoresCacheRef, partInfoCacheRef } = useCutListCacheContext();

  return useMemo(() => {
    if (!activeAssembly) return EMPTY;
    const subAsmCacheAdapter = {
      get: (p: string) =>
        subAssemblyDocs[p]
          ? { kind: 'ok' as const, doc: subAssemblyDocs[p]!, partPath: p }
          : undefined,
    };
    // Build a bores map containing only parts that actually have bores.
    const boresMap = new Map<string, import('@zilventor/shared').BoreOp[]>();
    for (const [k, v] of (partBoresCacheRef.current ?? new Map()).entries()) {
      if (v && v.length > 0) boresMap.set(k, v);
    }
    const raw = aggregateConnectorBomRecursive(
      activeAssembly,
      subAsmCacheAdapter,
      boresMap,
      partInfoCacheRef.current ?? new Map(),
    );
    // i18n resolution: pure aggregator returns nameKey; hook resolves to display name
    return raw.map((r) => ({
      kind: r.kind,
      name: t(r.nameKey),
      qty: r.qty,
      notes: r.notes,
    }));
  }, [activeAssembly, subAssemblyDocs, partBoresCacheRef, partInfoCacheRef, t]);
}
