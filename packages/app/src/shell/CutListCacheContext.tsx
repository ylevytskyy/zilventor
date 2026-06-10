import { createContext, useContext } from 'react';
import type { RefObject } from 'react';
import type { PanelSpecCache } from './resolvePanelSpec';
import type { BoreOp, PartInfo } from '@zilventor/shared';

export type CutListCacheContextValue = {
  panelSpecCacheRef: RefObject<PanelSpecCache>;
  partInfoCacheRef: RefObject<Map<string, PartInfo>>;
  /** Bores per partPath; populated alongside geometryCacheRef when the kernel loads a part doc. */
  partBoresCacheRef: RefObject<Map<string, BoreOp[] | undefined>>;
  /** Warms the panelSpecCacheRef from OPFS for all leaf parts in the active assembly. */
  warmCache: () => Promise<void>;
  /**
   * Evicts the given partPaths from the geometry + bore + kernel-id caches and
   * bumps the active-assembly identity so the mesh-sync effect re-loads the
   * affected parts from OPFS (picking up freshly written bores, etc.).
   */
  invalidatePartPaths: (paths: string[]) => Promise<void>;
};

export const CutListCacheContext = createContext<CutListCacheContextValue | null>(null);

const NOOP_ASYNC = (): Promise<void> => Promise.resolve();

export function useCutListCacheContext(): CutListCacheContextValue {
  const ctx = useContext(CutListCacheContext);
  if (!ctx) {
    // Outside a CutListCacheContext.Provider — return empty maps so the hook degrades gracefully.
    return {
      panelSpecCacheRef: { current: new Map() },
      partInfoCacheRef: { current: new Map() },
      partBoresCacheRef: { current: new Map() },
      warmCache: NOOP_ASYNC,
      invalidatePartPaths: NOOP_ASYNC,
    };
  }
  return ctx;
}
