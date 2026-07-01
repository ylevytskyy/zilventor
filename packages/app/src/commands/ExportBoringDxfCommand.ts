import { renderBoringDxf } from '../drawing/renderBoringDxf';
import type { BoringAggregateResult } from '../assembly/walkers/aggregateBoresRecursive';
import i18n from '../i18n';

declare global {

  var __zilventorBoringDxfBytes: Uint8Array | undefined;
}

interface FsHandle {
  createWritable: () => Promise<{ write: (data: Uint8Array) => Promise<void>; close: () => Promise<void> }>;
}
type SaveFilePicker = (opts: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<FsHandle>;

export class ExportBoringDxfCommand {
  constructor(private opts: { result: BoringAggregateResult; suggestedName: string; showToast?: ((message: string) => void) | undefined }) {}

  async apply(): Promise<void> {
    // R1: surface each collected preflight diagnostic (name/material/geometry)
    // as a user-facing toast instead of leaving it as a console.warn only.
    for (const d of this.opts.result.diagnostics ?? []) {
      this.opts.showToast?.(i18n.t(d.reasonKey, d.params ?? {}));
    }
    const dxf = renderBoringDxf(this.opts.result);
    const bytes = new TextEncoder().encode(dxf);
    globalThis.__zilventorBoringDxfBytes = bytes;
    const picker = (globalThis as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
    if (typeof picker === 'function') {
      try {
        const handle = await picker({
          suggestedName: this.opts.suggestedName,
          types: [{ description: 'DXF', accept: { 'application/dxf': ['.dxf'] } }],
        });
        const w = await handle.createWritable();
        await w.write(bytes);
        await w.close();
      } catch (err) {
        const e = err as { name?: string };
        if (e?.name === 'AbortError') return;
        if (typeof document === 'undefined') return;
        this.downloadFallback(bytes);
      }
      return;
    }
    if (typeof document !== 'undefined') this.downloadFallback(bytes);
  }

  private downloadFallback(bytes: Uint8Array): void {
    const blob = new Blob([bytes as unknown as Uint8Array<ArrayBuffer>], { type: 'application/dxf' });
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
