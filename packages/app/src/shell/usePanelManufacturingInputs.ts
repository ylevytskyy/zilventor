import { useMemo } from 'react';
import { useCutListResult } from './useCutListResult';
import { useBoringResult } from './useBoringResult';
import { useCutListCacheContext } from './CutListCacheContext';
import { aggregatePanelManufacturing } from '../assembly/walkers/aggregatePanelManufacturing';
import type { PanelManufacturingInput } from '../drawing/renderPanelManufacturingDxf';
import { useAppStore } from '../store/useAppStore';

const EMPTY: PanelManufacturingInput[] = [];

export function usePanelManufacturingInputs(): PanelManufacturingInput[] {
  const activeAssembly = useAppStore((s) => s.activeAssembly);
  const cutListResult = useCutListResult();
  const boringResult = useBoringResult();
  const { partGroovesCacheRef, partTenonMortisesCacheRef } = useCutListCacheContext();

  return useMemo(() => {
    if (!activeAssembly) return EMPTY;
    return aggregatePanelManufacturing(
      cutListResult, boringResult,
      partGroovesCacheRef.current ?? new Map(),
      partTenonMortisesCacheRef.current ?? new Map(),
    );
  }, [activeAssembly, cutListResult, boringResult, partGroovesCacheRef, partTenonMortisesCacheRef]);
}
