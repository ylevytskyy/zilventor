import { renderNestSheetDxf } from '../drawing/renderNestSheetDxf';
import { buildDxfZip } from '../drawing/dxfZip';
import type { NestState } from '@zilventor/shared';
import type { MaterialRegistry } from '@zilventor/shared';

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_');
}

export function buildNestZipEntries(
  nest: NestState,
  materials: MaterialRegistry,
): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const sheet of nest.sheets) {
    const materialName = materials.find((m) => m.id === sheet.materialId)?.name ?? sheet.materialId;
    const sheetCount = nest.sheets.filter((s) => s.materialId === sheet.materialId).length;
    entries[`${sanitize(sheet.materialId)}-sheet-${sheet.sheetIndex + 1}.dxf`] =
      renderNestSheetDxf(sheet, { sheetCount, materialName });
  }
  return entries;
}

declare global {
  // eslint-disable-next-line no-var
  var __zilventorNestDxfBytes: Uint8Array | undefined;
}

interface FsHandle {
  createWritable: () => Promise<{ write: (data: Uint8Array) => Promise<void>; close: () => Promise<void> }>;
}
type SaveFilePicker = (opts: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<FsHandle>;

export class ExportNestDxfCommand {
  constructor(private opts: { nest: NestState; materials: MaterialRegistry; suggestedName: string }) {}

  async apply(): Promise<void> {
    const bytes = buildDxfZip(buildNestZipEntries(this.opts.nest, this.opts.materials));
    globalThis.__zilventorNestDxfBytes = bytes;
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
