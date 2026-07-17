import { renderViyarProFlattenDxf } from '../drawing/renderViyarProFlattenDxf';
import type { PanelManufacturingInput } from '../drawing/renderPanelManufacturingDxf';

declare global {

  var __zilventorViyarProDxfBytes: Uint8Array | undefined;
}

interface FsHandle {
  createWritable: () => Promise<{ write: (data: Uint8Array) => Promise<void>; close: () => Promise<void> }>;
}
type SaveFilePicker = (opts: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<FsHandle>;

export class ExportViyarProFlattenDxfCommand {
  constructor(private opts: { inputs: PanelManufacturingInput[]; suggestedName: string }) {}

  async apply(): Promise<void> {
    const dxf = renderViyarProFlattenDxf(this.opts.inputs);
    const bytes = new TextEncoder().encode(dxf);
    globalThis.__zilventorViyarProDxfBytes = bytes;
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
