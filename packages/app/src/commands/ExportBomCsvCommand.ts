import { useAppStore } from '../store/useAppStore';
import { aggregateBomRecursive } from '../assembly/walkers/aggregateBomRecursive';
import { buildBomCsv } from './buildBomCsv';
import type { PartInfo } from '@zilventor/shared';
import i18n from '../i18n';

export class ExportBomCsvCommand {
  constructor(private opts: { partInfo: Map<string, PartInfo> }) {}
  async apply(): Promise<void> {
    const a = useAppStore.getState().activeAssembly;
    if (!a) return;
    // 4d Phase 11b T42: walk into placed sub-assemblies so the CSV reflects
    // the recursive leaf count (mirrors BomTable's aggregator).
    const docs = useAppStore.getState().subAssemblyDocs;
    const cache = {
      get: (p: string) =>
        docs[p]
          ? ({ kind: 'ok' as const, doc: docs[p]!, partPath: p })
          : undefined,
    };
    const rows = aggregateBomRecursive(a, cache, this.opts.partInfo);
    const csv = buildBomCsv(rows);
    const bytes = new TextEncoder().encode(csv);
    const suggestedName = `${a.name}-bom.csv`;

    if (import.meta.env.DEV) {
      const w = window as unknown as Record<string, unknown>;
      w.__zilventorBomCsvBytes = () => bytes;
    }

    const w2 = (typeof window !== 'undefined' ? window : globalThis) as unknown as { showSaveFilePicker?: (opts: any) => Promise<any> };
    if (typeof w2.showSaveFilePicker === 'function') {
      try {
        const handle = await w2.showSaveFilePicker({
          suggestedName,
          types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(bytes);
        await writable.close();
        useAppStore.getState().setStatus(rows.length === 0 ? i18n.t('status.exportBom.empty') : i18n.t('status.exportBom.rows', { count: rows.length }));
      } catch {
        // User cancelled or write failed — silent no-op.
      }
      return;
    }
    if (typeof document === 'undefined') return;
    const blob = new Blob([bytes], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a2 = document.createElement('a');
    a2.href = url; a2.download = suggestedName;
    document.body.appendChild(a2); a2.click(); document.body.removeChild(a2);
    URL.revokeObjectURL(url);
    useAppStore.getState().setStatus(rows.length === 0 ? i18n.t('status.exportBom.empty') : i18n.t('status.exportBom.rows', { count: rows.length }));
  }
}
