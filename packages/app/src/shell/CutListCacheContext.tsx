import { createContext, useContext } from 'react';
import type { RefObject } from 'react';
import type { PanelSpecCache } from './resolvePanelSpec';
import type { PartInfo } from '@zilventor/shared';

export type CutListCacheContextValue = {
  panelSpecCacheRef: RefObject<PanelSpecCache>;
  partInfoCacheRef: RefObject<Map<string, PartInfo>>;
};

export const CutListCacheContext = createContext<CutListCacheContextValue | null>(null);

export function useCutListCacheContext(): CutListCacheContextValue {
  const ctx = useContext(CutListCacheContext);
  if (!ctx) {
    // Outside a CutListCacheContext.Provider — return empty maps so the hook degrades gracefully.
    return {
      panelSpecCacheRef: { current: new Map() },
      partInfoCacheRef: { current: new Map() },
    };
  }
  return ctx;
}
