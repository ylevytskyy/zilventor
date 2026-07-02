import type { Command } from './Command';
import type { BoreOp, MachiningPresetValues, ShelfPinParams } from '@zilventor/shared';
import {
  shelfPinGrid,
  CURRENT_FORMAT_VERSION,
} from '@zilventor/shared';

/** Mirrors GenerateShelfPinBoresCommand's snapshot-preset helper (P9 W2a, D1) —
 *  diameter/depth here are shop-configurable dialog inputs, not catalog-dictated,
 *  so the full preset transfers onto every generated bore. */
function withPresetValues(bores: BoreOp[], preset?: MachiningPresetValues): BoreOp[] {
  if (!preset) return bores;
  return bores.map((b) => ({
    ...b,
    diameter: preset.diameter,
    depth: preset.depth,
    presetLayerName: preset.layerName,
    ...(preset.toolNumber === undefined ? {} : { toolNumber: preset.toolNumber }),
    ...(preset.speed === undefined ? {} : { speed: preset.speed }),
  }));
}
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { useAppStore } from '../store/useAppStore';

type OpfsRW = { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };

/** Read a panel's resolved dims from its single PanelFeature inside the .zipt manifest.
 *  Uses `featureTree` (the real PartDocument field). Only literal dims are supported. */
function panelDimsFromDoc(
  doc: { featureTree?: Array<Record<string, unknown>> },
): { length: number; width: number; thickness: number } {
  const panel = (doc.featureTree ?? []).find((f) => f.kind === 'panel') as
    | { length: unknown; width: unknown; thickness: unknown }
    | undefined;
  if (!panel) throw new Error('NO_PANEL_FEATURE');

  function resolve(v: unknown, name: string): number {
    if (typeof v === 'number') return v;
    if (v !== null && typeof v === 'object' && (v as Record<string, unknown>).kind === 'literal') {
      const val = (v as { value: unknown }).value;
      if (typeof val === 'number') return val;
    }
    throw new Error(`UNRESOLVABLE_DIM: ${name}`);
  }

  return {
    length: resolve(panel.length, 'length'),
    width: resolve(panel.width, 'width'),
    thickness: resolve(panel.thickness, 'thickness'),
  };
}

export class AddManualShelfPinBoresCommand implements Command {
  readonly name = 'AddManualShelfPinBores';
  /** Prior bores[] on the panel (for revert), or null if not yet applied. */
  private priorBores: BoreOp[] | null = null;
  private readonly store: typeof useAppStore;

  constructor(private readonly opts: {
    panelPath: string;
    face: 'Top' | 'Bottom';
    params: ShelfPinParams;
    /** Snapshotted machining-preset values (P9 W2a, ADR 0001) — VALUES, not a
     *  preset id, so editing the preset later never changes already-created bores. */
    presetValues?: MachiningPresetValues;
    opfs: OpfsRW;
    store?: typeof useAppStore;
  }) {
    this.store = opts.store ?? useAppStore;
  }

  async apply(): Promise<void> {
    const { panelPath, face, params, opfs } = this.opts;
    const project = await opfs.read(panelPath).then(unpackProject);
    const manifest = project.manifest as { document: Record<string, unknown> };
    const document = manifest.document;

    const dims = panelDimsFromDoc(document as { featureTree?: Array<Record<string, unknown>> });
    const newBores = withPresetValues(shelfPinGrid(dims, face, params), this.opts.presetValues);

    const existing = (document.bores as BoreOp[] | undefined) ?? [];
    this.priorBores = existing;
    document.bores = [...existing, ...newBores];

    await opfs.write(
      panelPath,
      await packProject({
        manifest: { ...manifest, formatVersion: CURRENT_FORMAT_VERSION, document },
        blobs: {},
      }),
    );

    this.store.getState().boreCacheInvalidator?.([panelPath]);
  }

  async revert(): Promise<void> {
    if (this.priorBores === null) return;
    const { panelPath, opfs } = this.opts;
    const project = await opfs.read(panelPath).then(unpackProject);
    const manifest = project.manifest as { document: Record<string, unknown> };
    if (this.priorBores.length > 0) {
      manifest.document.bores = this.priorBores;
    } else {
      delete manifest.document.bores;
    }
    await opfs.write(
      panelPath,
      await packProject({
        manifest: { ...manifest, formatVersion: CURRENT_FORMAT_VERSION },
        blobs: {},
      }),
    );
    this.priorBores = null;
    this.store.getState().boreCacheInvalidator?.([panelPath]);
  }
}
