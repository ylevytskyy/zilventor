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

// R4.1(a): CNC zip entries are grouped into per-material subfolders — a key
// containing "/" is treated as a folder by fflate.zipSync (dxfZip.ts). If the
// material name sanitizes to an empty string (only happens when materialName
// itself is empty — sanitize() substitutes disallowed characters rather than
// stripping them), fall back to the sanitized materialId, then to a fixed
// "material" folder so an entry never lands keyless at the zip root.
function materialFolder(materialName: string, materialId: string | undefined): string {
  const byName = sanitize(materialName);
  if (byName) return byName;
  const byId = materialId ? sanitize(materialId) : '';
  return byId || 'material';
}

export function buildManufacturingZipEntries(
  inputs: PanelManufacturingInput[],
): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const input of inputs) {
    const folder = materialFolder(input.materialName, input.spec?.materialId);
    entries[`${folder}/item-${input.itemNumber}-${sanitize(input.partName)}.dxf`] =
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
