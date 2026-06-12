import { buildCutListCsv } from './buildCutListCsv';
import type { CutListResult } from '@zilventor/shared/src/cutListRow';
import type { HardwareRow } from '../assembly/walkers/aggregateHardwareRecursive';
import type { ConnectorBomRow } from '../shell/ConnectorBomTable';

declare global {
   
  var __zilventorCutListCsvBytes: Uint8Array | undefined;
}

interface FsHandle {
  createWritable: () => Promise<{ write: (data: Uint8Array) => Promise<void>; close: () => Promise<void> }>;
}
type SaveFilePicker = (opts: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<FsHandle>;

export class ExportCutListCsvCommand {
  constructor(private opts: { result: CutListResult; hardwareRows?: HardwareRow[]; connectorRows?: ConnectorBomRow[]; suggestedName: string }) {}

  async apply(): Promise<void> {
    const csv = buildCutListCsv(this.opts.result, this.opts.hardwareRows ?? [], this.opts.connectorRows ?? []);
    const bytes = new TextEncoder().encode(csv);
    globalThis.__zilventorCutListCsvBytes = bytes;
    const picker = (globalThis as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
    if (typeof picker === 'function') {
      try {
        const handle = await picker({
          suggestedName: this.opts.suggestedName,
          types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }],
        });
        const w = await handle.createWritable();
        await w.write(bytes);
        await w.close();
      } catch (err) {
        const e = err as { name?: string };
        if (e?.name === 'AbortError') return;
        // Fallthrough to <a download> on other errors only if document exists.
        if (typeof document === 'undefined') return;
        this.downloadFallback(bytes);
      }
      return;
    }
    if (typeof document !== 'undefined') this.downloadFallback(bytes);
  }

  private downloadFallback(bytes: Uint8Array): void {
    const blob = new Blob([bytes as unknown as Uint8Array<ArrayBuffer>], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.opts.suggestedName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
