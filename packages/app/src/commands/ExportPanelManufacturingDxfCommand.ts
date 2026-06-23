import { renderPanelManufacturingDxf, type PanelManufacturingInput } from '../drawing/renderPanelManufacturingDxf';
import { buildDxfZip } from '../drawing/dxfZip';

declare global {
  var __zilventorManufacturingDxfBytes: Uint8Array | undefined;
}

interface FsHandle {
  createWritable: () => Promise<{ write: (data: Uint8Array) => Promise<void>; close: () => Promise<void> }>;
}
type SaveFilePicker = (opts: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<FsHandle>;

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_');
}

export function buildManufacturingZipEntries(
  inputs: PanelManufacturingInput[],
): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const input of inputs) {
    entries[`item-${input.itemNumber}-${sanitize(input.partName)}.dxf`] =
      renderPanelManufacturingDxf(input);
  }
  return entries;
}

export class ExportPanelManufacturingDxfCommand {
  constructor(private opts: { inputs: PanelManufacturingInput[]; suggestedName: string }) {}

  async apply(): Promise<void> {
    const bytes = buildDxfZip(buildManufacturingZipEntries(this.opts.inputs));
    globalThis.__zilventorManufacturingDxfBytes = bytes;
    const picker = (globalThis as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
    if (typeof picker === 'function') {
      try {
        const handle = await picker({
          suggestedName: this.opts.suggestedName,
          types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }],
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
    const blob = new Blob([bytes as unknown as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
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
