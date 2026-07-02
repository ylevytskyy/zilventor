import { createContext, useContext } from 'react';
import type { RefObject } from 'react';
import type { PanelSpecCache } from './resolvePanelSpec';
import type { BoreOp, GrooveFeature, TenonMortiseFeature, PartInfo, PanelPreflightDiagnostic } from '@zilventor/shared';

export type CutListCacheContextValue = {
  panelSpecCacheRef: RefObject<PanelSpecCache>;
  partInfoCacheRef: RefObject<Map<string, PartInfo>>;
  /** Bores per partPath; populated alongside geometryCacheRef when the kernel loads a part doc. */
  partBoresCacheRef: RefObject<Map<string, BoreOp[] | undefined>>;
  /** Grooves per partPath; populated alongside partBoresCacheRef when the kernel loads a part doc. */
  partGroovesCacheRef: RefObject<Map<string, GrooveFeature[]>>;
  /** Tenon/mortise features per partPath; populated alongside partGroovesCacheRef when the kernel loads a part doc. */
  partTenonMortisesCacheRef: RefObject<Map<string, TenonMortiseFeature[]>>;
  /** R1 preflight diagnostics collected by the last warmCache() pass (via
   *  loadCutListInputs → resolvePanelSpec); threaded onto CutListResult by
   *  useCutListResult so cut-list/manufacturing/nesting toasts stay live. */
  diagnosticsCacheRef: RefObject<PanelPreflightDiagnostic[]>;
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
      partGroovesCacheRef: { current: new Map() },
      partTenonMortisesCacheRef: { current: new Map() },
      diagnosticsCacheRef: { current: [] },
      warmCache: NOOP_ASYNC,
      invalidatePartPaths: NOOP_ASYNC,
    };
  }
  return ctx;
}
