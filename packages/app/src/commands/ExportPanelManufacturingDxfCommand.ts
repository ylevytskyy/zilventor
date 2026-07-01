import { renderPanelManufacturingDxf, type PanelManufacturingInput } from '../drawing/renderPanelManufacturingDxf';
import { buildDxfZip } from '../drawing/dxfZip';
import type { PanelPreflightDiagnostic } from '@zilventor/shared';
import i18n from '../i18n';

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
  constructor(private opts: {
    inputs: PanelManufacturingInput[];
    suggestedName: string;
    diagnostics?: PanelPreflightDiagnostic[] | undefined;
    showToast?: ((message: string) => void) | undefined;
  }) {}

  async apply(): Promise<void> {
    // R1: surface each collected preflight diagnostic (name/material/geometry)
    // as a user-facing toast instead of leaving it as a console.warn only.
    for (const d of this.opts.diagnostics ?? []) {
      this.opts.showToast?.(i18n.t(d.reasonKey, d.params ?? {}));
    }
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
