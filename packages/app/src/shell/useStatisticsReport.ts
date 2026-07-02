import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useCutListResult } from './useCutListResult';
import { useConnectorBomResult } from './useConnectorBomResult';
import { aggregateHardwareRecursive } from '../assembly/walkers/aggregateHardwareRecursive';
import { buildHardwareCache } from '../assembly/walkers/buildHardwareCache';
import { resolveHardwareCatalog } from '@zilventor/shared/src/hardware/resolveCatalog';
import { partitionLinearMaterial } from '@zilventor/shared/src/linearMaterial';
import { buildStatisticsReport, type StatisticsReport } from '../commands/buildStatisticsReport';

const EMPTY_REPORT: StatisticsReport = { sections: [], grandTotal: 0, unpricedLineCount: 0 };

/**
 * Gathers the five StatisticsReport category inputs (hardware, connectors,
 * edgeband totals, linear-material breakdowns, panel/sheet rows) from the
 * active assembly and feeds them through the pure buildStatisticsReport()
 * builder, threading per-document unitPrices + the app-global default price
 * book (P4 — cost report).
 */
export function useStatisticsReport(): StatisticsReport {
  const activeAssembly = useAppStore((s) => s.activeAssembly);
  const subAssemblyDocs = useAppStore((s) => s.subAssemblyDocs);
  const defaultPriceBook = useAppStore((s) => s.defaultPriceBook);
  const cutListResult = useCutListResult();
  const connectorRows = useConnectorBomResult();

  return useMemo(() => {
    if (!activeAssembly) return EMPTY_REPORT;

    const hwCache = buildHardwareCache(activeAssembly, subAssemblyDocs);
    const hardwareRows = aggregateHardwareRecursive(
      activeAssembly,
      hwCache,
      [...resolveHardwareCatalog(activeAssembly)],
    ).rows;

    const { panelRows, linearBreakdowns } = partitionLinearMaterial(
      cutListResult.rows,
      activeAssembly.materials ?? [],
    );

    return buildStatisticsReport({
      hardwareRows,
      connectorRows,
      bandTotals: cutListResult.bandTotals,
      linearBreakdowns,
      panelRows,
      unitPrices: activeAssembly.unitPrices ?? {},
      defaultPriceBook,
    });
  }, [activeAssembly, subAssemblyDocs, defaultPriceBook, cutListResult, connectorRows]);
}
