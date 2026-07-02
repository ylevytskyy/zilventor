import { renderPanelManufacturingDxf, renderCombinedManufacturingDxf, type PanelManufacturingInput } from '../drawing/renderPanelManufacturingDxf';
import { buildManufacturingCsv } from '../drawing/manufacturingCsv';
import { buildDxfZip } from '../drawing/dxfZip';
import { triggerDownload } from '../nesting/triggerDownload';
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

// Unicode-aware sanitizer for the zip *folder* key only — unlike sanitize()
// above (ASCII-only, used for DXF entry filenames/content, which must stay
// ASCII), this keeps Unicode letters/digits so Cyrillic material names stay
// legible instead of collapsing to underscores.
function sanitizeFolder(name: string): string {
  return name.replace(/[^\p{L}\p{N}_-]/gu, '_');
}

// R4.1(a): CNC zip entries are grouped into per-material subfolders — a key
// containing "/" is treated as a folder by fflate.zipSync (dxfZip.ts). If the
// material name sanitizes to an empty string (only happens when materialName
// itself is empty — sanitizeFolder() substitutes disallowed characters rather
// than stripping them), fall back to the sanitized materialId, then to a
// fixed "material" folder so an entry never lands keyless at the zip root.
function materialFolder(materialName: string, materialId: string | undefined): string {
  const byName = sanitizeFolder(materialName);
  if (byName) return byName;
  const byId = materialId ? sanitizeFolder(materialId) : '';
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

export function buildCombinedManufacturingDxf(inputs: PanelManufacturingInput[]): string {
  return renderCombinedManufacturingDxf(inputs);
}

function combinedDxfFileName(suggestedName: string): string {
  const base = suggestedName.replace(/\.zip$/, '');
  return `${base}-combined.dxf`;
}

// D6 (2026-07-03-p9-preset-coverage.md): gates the combined-mode CSV sidecar to only
// fire when at least one bore/groove/tenonMortise actually carries a preset-derived
// field — otherwise every combined export would drop an empty CSV into Downloads.
function hasMachiningMetadata(inputs: PanelManufacturingInput[]): boolean {
  const has = (op: { toolNumber?: number; speed?: number; presetLayerName?: string }): boolean =>
    op.toolNumber !== undefined || op.speed !== undefined || op.presetLayerName !== undefined;
  return inputs.some(
    (input) =>
      input.bores.some(has) || input.grooves.some(has) || (input.tenonMortises ?? []).some(has),
  );
}

export class ExportPanelManufacturingDxfCommand {
  constructor(private opts: {
    inputs: PanelManufacturingInput[];
    suggestedName: string;
    mode?: 'folders' | 'combined' | undefined;
    diagnostics?: PanelPreflightDiagnostic[] | undefined;
    showToast?: ((message: string) => void) | undefined;
  }) {}

  async apply(): Promise<void> {
    // R1: surface each collected preflight diagnostic (name/material/geometry)
    // as a user-facing toast instead of leaving it as a console.warn only.
    for (const d of this.opts.diagnostics ?? []) {
      this.opts.showToast?.(i18n.t(d.reasonKey, d.params ?? {}));
    }
    const combined = this.opts.mode === 'combined';
    // D2/S1: sidecar machining.csv ships INLINE in the folders/zip mode, at the ZIP ROOT —
    // added here (not inside buildManufacturingZipEntries) so that function's per-material
    // DXF-entries contract stays exactly as tested. D6 (2026-07-03-p9-preset-coverage.md):
    // combined mode's single-DXF *bytes* stay byte-for-byte untouched (no CSV inlined —
    // several e2e/unit contracts assert this) — instead, machining.csv ships as a second,
    // sequential download after the primary .dxf, gated on hasMachiningMetadata() below.
    // This supersedes the old "combined mode has no CSV at all" decision.
    const bytes = combined
      ? new TextEncoder().encode(buildCombinedManufacturingDxf(this.opts.inputs))
      : buildDxfZip({
          ...buildManufacturingZipEntries(this.opts.inputs),
          'machining.csv': buildManufacturingCsv(this.opts.inputs),
        });
    globalThis.__zilventorManufacturingDxfBytes = bytes;
    const suggestedName = combined ? combinedDxfFileName(this.opts.suggestedName) : this.opts.suggestedName;
    const types = combined
      ? [{ description: 'DXF', accept: { 'application/dxf': ['.dxf'] } }]
      : [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }];
    const picker = (globalThis as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
    let delivered = false;
    if (typeof picker === 'function') {
      try {
        const handle = await picker({ suggestedName, types });
        const w = await handle.createWritable();
        await w.write(bytes);
        await w.close();
        delivered = true;
      } catch (err) {
        const e = err as { name?: string };
        if (e?.name === 'AbortError') return;
        if (typeof document === 'undefined') return;
        this.downloadFallback(bytes, suggestedName, combined);
        delivered = true;
      }
    } else if (typeof document !== 'undefined') {
      this.downloadFallback(bytes, suggestedName, combined);
      delivered = true;
    }
    if (delivered && combined && hasMachiningMetadata(this.opts.inputs)) {
      const csv = buildManufacturingCsv(this.opts.inputs);
      await triggerDownload(new Blob([csv], { type: 'text/csv' }), {
        suggestedName: 'machining.csv',
        mimeType: 'text/csv',
        extension: 'csv',
        description: 'CSV',
      });
    }
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
