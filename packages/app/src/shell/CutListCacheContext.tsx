import { createContext, useContext } from 'react';
import type { RefObject } from 'react';
import type { PanelSpecCache } from './resolvePanelSpec';
import type { BoreOp, GrooveFeature, TenonMortiseFeature, KeyholeSlotFeature, PartInfo, PanelPreflightDiagnostic } from '@zilventor/shared';

export type CutListCacheContextValue = {
  panelSpecCacheRef: RefObject<PanelSpecCache>;
  partInfoCacheRef: RefObject<Map<string, PartInfo>>;
  /** Bores per partPath; populated alongside geometryCacheRef when the kernel loads a part doc. */
  partBoresCacheRef: RefObject<Map<string, BoreOp[] | undefined>>;
  /** Grooves per partPath; populated alongside partBoresCacheRef when the kernel loads a part doc. */
  partGroovesCacheRef: RefObject<Map<string, GrooveFeature[]>>;
  /** Tenon/mortise features per partPath; populated alongside partGroovesCacheRef when the kernel loads a part doc. */
  partTenonMortisesCacheRef: RefObject<Map<string, TenonMortiseFeature[]>>;
  /** Keyhole-slot features per partPath; populated alongside partTenonMortisesCacheRef when the kernel loads a part doc. */
  partKeyholeSlotsCacheRef: RefObject<Map<string, KeyholeSlotFeature[]>>;
  /** R1 preflight diagnostics collected by the last warmCache() pass (via
   *  loadCutListInputs → resolvePanelSpec); threaded onto CutListResult by
   *  useCutListResult so cut-list/manufacturing/nesting toasts stay live. */
  diagnosticsCacheRef: RefObject<PanelPreflightDiagnostic[]>;
  /** Bumped after each partInfoCacheRef population pass so consumers (e.g.
   *  useCutListResult) know to recompute even when activeAssembly/subAssemblyDocs
   *  identity hasn't changed. */
  partInfoVersion: number;
  /** Bumped by the assembly mesh-sync effect (App.tsx) after it finishes
   *  repopulating partBoresCacheRef/partGroovesCacheRef/etc. from OPFS for a
   *  render cycle. Consumers that memoize over the bore/groove/tenon caches
   *  (e.g. useBoringResult) list this as a dep so they recompute once the
   *  async reload actually lands — independent of activeAssembly/
   *  subAssemblyDocs identity and of whether the Cut List tab has ever been
   *  opened. */
  geometryReadyTick: number;
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
      partKeyholeSlotsCacheRef: { current: new Map() },
      diagnosticsCacheRef: { current: [] },
      partInfoVersion: 0,
      geometryReadyTick: 0,
      warmCache: NOOP_ASYNC,
      invalidatePartPaths: NOOP_ASYNC,
    };
  }
  return ctx;
}
