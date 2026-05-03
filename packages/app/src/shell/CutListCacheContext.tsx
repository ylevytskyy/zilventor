import { createContext, useContext } from 'react';
import type { RefObject } from 'react';
import type { PanelSpecCache } from './resolvePanelSpec';
import type { PartInfo } from '@zilventor/shared';

export type CutListCacheContextValue = {
  panelSpecCacheRef: RefObject<PanelSpecCache>;
  partInfoCacheRef: RefObject<Map<string, PartInfo>>;
  /** Warms the panelSpecCacheRef from OPFS for all leaf parts in the active assembly. */
  warmCache: () => Promise<void>;
};

export const CutListCacheContext = createContext<CutListCacheContextValue | null>(null);

const NOOP_WARM = (): Promise<void> => Promise.resolve();

export function useCutListCacheContext(): CutListCacheContextValue {
  const ctx = useContext(CutListCacheContext);
  if (!ctx) {
    // Outside a CutListCacheContext.Provider — return empty maps so the hook degrades gracefully.
    return {
      panelSpecCacheRef: { current: new Map() },
      partInfoCacheRef: { current: new Map() },
      warmCache: NOOP_WARM,
    };
  }
  return ctx;
}
