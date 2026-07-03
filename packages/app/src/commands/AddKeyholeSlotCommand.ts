import type { Command } from './Command';
import type { KeyholeSlotFeature, KeyholeSlotSpec, PartDocument } from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import { addFeature } from '@zilventor/kernel/src/adapter/PartDocument';
import { writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { useAppStore } from '../store/useAppStore';

export type AddKeyholeSlotOpts = {
  partPath: string;
  keyholeSlot: KeyholeSlotSpec;
  opfs: { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };
  store?: typeof useAppStore;
};

let keyholeSlotCounter = 0;

/**
 * Cuts a localized keyhole-slot pocket (wall-hanger routing) into a panel
 * part by appending a `kind:'keyholeSlot'` feature to its feature tree. The
 * cylinder∪box pocket re-cuts on every execute, so it survives save/reload —
 * mirrors AddGrooveCommand 1:1. Re-render + kernel-part refresh are handled
 * by the store's boreCacheInvalidator.
 *
 * Undo restores the original `.zipt` bytes, which preserves any pre-existing
 * bores (they live in the manifest, untouched by the slot).
 */
export class AddKeyholeSlotCommand implements Command {
  readonly name = 'AddKeyholeSlot';
  private priorBytes: Uint8Array | null = null;
  private readonly store: typeof useAppStore;

  constructor(private readonly opts: AddKeyholeSlotOpts) {
    this.store = opts.store ?? useAppStore;
  }

  async apply(): Promise<void> {
    const bytes = await this.opts.opfs.read(this.opts.partPath);
    this.priorBytes = bytes;
    const project = await unpackProject(bytes);
    const manifest = project.manifest as { document: PartDocument };

    const feature: KeyholeSlotFeature = {
      kind: 'keyholeSlot',
      id: `keyholeSlot-${keyholeSlotCounter++}`,
      ...this.opts.keyholeSlot,
    };
    const doc = addFeature(manifest.document, feature);

    await this.persist(doc);
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
