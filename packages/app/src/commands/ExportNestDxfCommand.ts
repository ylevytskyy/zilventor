import { renderNestSheetDxf, renderCombinedNestDxf } from '../drawing/renderNestSheetDxf';
import { buildDxfZip } from '../drawing/dxfZip';
import type { NestState, NestSheet } from '@zilventor/shared';
import type { MaterialRegistry } from '@zilventor/shared';

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_');
}

// Unicode-aware sanitizer for the zip *folder* key only — unlike sanitize()
// above (ASCII-only, used for DXF entry filenames/content, which must stay
// ASCII), this keeps Unicode letters/digits so Cyrillic material names stay
// legible instead of collapsing to underscores.
function sanitizeFolder(name: string): string {
  return name.replace(/[^\p{L}\p{N}_-]/gu, '_');
}

// R4.1(a): CNC zip entries are grouped into per-material subfolders — a key
// containing "/" is treated as a folder by fflate.zipSync (dxfZip.ts). If the
// resolved material name sanitizes to an empty string (only happens when the
// name itself is empty — sanitizeFolder() substitutes disallowed characters
// rather than stripping them), fall back to the sanitized materialId, then to
// a fixed "material" folder so an entry never lands keyless at the zip root.
function materialFolder(materialName: string, materialId: string): string {
  const byName = sanitizeFolder(materialName);
  if (byName) return byName;
  const byId = sanitizeFolder(materialId);
  return byId || 'material';
}

export function buildNestZipEntries(
  nest: NestState,
  materials: MaterialRegistry,
): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const sheet of nest.sheets) {
    const materialName = materials.find((m) => m.id === sheet.materialId)?.name ?? sheet.materialId;
    const sheetCount = nest.sheets.filter((s) => s.materialId === sheet.materialId).length;
    const folder = materialFolder(materialName, sheet.materialId);
    entries[`${folder}/${sanitize(sheet.materialId)}-sheet-${sheet.sheetIndex}.dxf`] =
      renderNestSheetDxf(sheet, { sheetCount, materialName });
  }
  return entries;
}

export function buildCombinedNestDxf(nest: NestState, materials: MaterialRegistry): string {
  const materialNames: Record<string, string> = {};
  for (const m of materials) materialNames[m.id] = m.name;
  return renderCombinedNestDxf(nest.sheets as NestSheet[], { materialNames });
}

function combinedDxfFileName(suggestedName: string): string {
  const base = suggestedName.replace(/\.zip$/, '');
  return `${base}-combined.dxf`;
}

declare global {
  var __zilventorNestDxfBytes: Uint8Array | undefined;
}

interface FsHandle {
  createWritable: () => Promise<{ write: (data: Uint8Array) => Promise<void>; close: () => Promise<void> }>;
}
type SaveFilePicker = (opts: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<FsHandle>;

export class ExportNestDxfCommand {
  constructor(private opts: {
    nest: NestState;
    materials: MaterialRegistry;
    suggestedName: string;
    mode?: 'folders' | 'combined' | undefined;
  }) {}

  async apply(): Promise<void> {
    const combined = this.opts.mode === 'combined';
    const bytes = combined
      ? new TextEncoder().encode(buildCombinedNestDxf(this.opts.nest, this.opts.materials))
      : buildDxfZip(buildNestZipEntries(this.opts.nest, this.opts.materials));
    globalThis.__zilventorNestDxfBytes = bytes;
    const suggestedName = combined ? combinedDxfFileName(this.opts.suggestedName) : this.opts.suggestedName;
    const types = combined
      ? [{ description: 'DXF', accept: { 'application/dxf': ['.dxf'] } }]
      : [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }];
    const picker = (globalThis as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
    if (typeof picker === 'function') {
      try {
        const handle = await picker({ suggestedName, types });
        const w = await handle.createWritable();
        await w.write(bytes);
        await w.close();
      } catch (err) {
        const e = err as { name?: string };
        if (e?.name === 'AbortError') return;
        if (typeof document === 'undefined') return;
        this.downloadFallback(bytes, suggestedName, combined);
      }
      return;
    }
    if (typeof document !== 'undefined') this.downloadFallback(bytes, suggestedName, combined);
  }

  private downloadFallback(bytes: Uint8Array, suggestedName: string, combined: boolean): void {
    const blob = new Blob([bytes as unknown as Uint8Array<ArrayBuffer>], { type: combined ? 'application/dxf' : 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
