import type { Command } from './Command';
import type { BoreOp, ShelfPinParams } from '@zilventor/shared';
import {
  shelfPinGrid,
  CURRENT_FORMAT_VERSION,
} from '@zilventor/shared';
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
    const newBores = shelfPinGrid(dims, face, params);

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
