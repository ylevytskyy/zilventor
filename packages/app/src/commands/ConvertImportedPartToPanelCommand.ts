import type { Command } from './Command';
import type { Feature, PanelFeature, PartDocument } from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import { validatePanelInvariant } from '@zilventor/kernel/src/adapter/PartDocument';
import { writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { useAppStore } from '../store/useAppStore';

export const NO_IMPORTED_FEATURE = 'NO_IMPORTED_FEATURE';

export type ConvertImportedPartToPanelOpts = {
  partPath: string;
  panel: PanelFeature;
  opfs: { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };
  store?: typeof useAppStore;
};

/**
 * Converts an imported STEP part into a fully parametric panel by replacing
 * its `kind:'imported'` feature, in place, with the given `PanelFeature`.
 * Replace (not augment) is architecturally forced: the kernel FeatureTree
 * requires `kind:'panel'` as the first user feature, and both the imported
 * and panel executors dispose+replace the running solid — there is no
 * geometry to carry over. The result is panel-only, so it needs no kernel
 * round-trip: manifest-only repack, same as AddGrooveCommand.
 *
 * Undo restores the original `.zipt` bytes byte-for-byte.
 */
export class ConvertImportedPartToPanelCommand implements Command {
  readonly name = 'ConvertImportedPartToPanel';
  private priorBytes: Uint8Array | null = null;
  private readonly store: typeof useAppStore;

  constructor(private readonly opts: ConvertImportedPartToPanelOpts) {
    this.store = opts.store ?? useAppStore;
  }

  async apply(): Promise<void> {
    const bytes = await this.opts.opfs.read(this.opts.partPath);
    this.priorBytes = bytes;
    const project = await unpackProject(bytes);
    const manifest = project.manifest as { document: PartDocument };
    const doc = manifest.document;

    const idx = doc.featureTree.findIndex((f) => f.kind === 'imported');
    if (idx === -1) {
      throw new Error(NO_IMPORTED_FEATURE);
    }

    const nextTree: Feature[] = [...doc.featureTree];
    nextTree[idx] = this.opts.panel;
    const nextDoc: PartDocument = { ...doc, featureTree: nextTree };
    validatePanelInvariant(nextDoc);

    await this.persist(nextDoc);
    this.store.getState().boreCacheInvalidator?.([this.opts.partPath]);
  }

  async revert(): Promise<void> {
    if (!this.priorBytes) return;
    await this.opts.opfs.write(this.opts.partPath, this.priorBytes);
    this.store.getState().boreCacheInvalidator?.([this.opts.partPath]);
  }

  private async persist(doc: PartDocument): Promise<void> {
    const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc };
    const repacked = await writeTarGz([
      { name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)) },
    ]);
    await this.opts.opfs.write(this.opts.partPath, repacked);
  }
}
