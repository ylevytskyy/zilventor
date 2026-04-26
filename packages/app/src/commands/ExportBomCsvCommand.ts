import { useAppStore } from '../store/useAppStore';
import { aggregateBom } from '@zilventor/shared/src/bomRow';
import { buildBomCsv } from './buildBomCsv';

export class ExportBomCsvCommand {
  constructor(private opts: { partNames: Map<string, string> }) {}
  async apply(): Promise<void> {
    const a = useAppStore.getState().activeAssembly;
    if (!a) return;
    const rows = aggregateBom(a, this.opts.partNames);
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
        useAppStore.getState().setStatus(rows.length === 0 ? 'Exported empty BOM' : `Exported ${rows.length} BOM rows`);
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
    useAppStore.getState().setStatus(rows.length === 0 ? 'Exported empty BOM' : `Exported ${rows.length} BOM rows`);
  }
}
