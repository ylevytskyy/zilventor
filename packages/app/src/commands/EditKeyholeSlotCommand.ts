import type { Command } from './Command';
import type { KeyholeSlotFeature, KeyholeSlotSpec, Feature } from '@zilventor/shared';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

type OpfsRW = { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };

type PatchableField = 'faceRole' | 'u' | 'v' | 'axis' | 'direction' | 'entryDiameter' | 'slotWidth' | 'slotLength' | 'depth';

interface EditKeyholeSlotOpts {
  keyholeSlot: KeyholeSlotFeature;
  patch: Partial<Pick<KeyholeSlotSpec, PatchableField>>;
  partPath: string;
  doc: { featureTree?: Feature[] };
  opfs: OpfsRW | null;
}

/**
 * Apply a positional/dimensional patch to a single KeyholeSlotFeature in
 * place (1:1 port of EditGrooveCommand). All 9 patchable fields are required
 * on KeyholeSlotSpec, so no absence-tracking is needed. The kernel's
 * executeTree re-cuts the keyhole slot from these fields on every rebuild —
 * mutating the live feature + invalidating panel caches is sufficient; no
 * explicit re-execute call here. Undoable: revert restores the prior value
 * of every patched field.
 */
export class EditKeyholeSlotCommand implements Command {
  readonly name = 'EditKeyholeSlot';
  /** Snapshot of only the fields present in `patch`, prior to apply. */
  private snapshot: Partial<Pick<KeyholeSlotSpec, PatchableField>>;

  constructor(private opts: EditKeyholeSlotOpts) {
    const { keyholeSlot, patch } = opts;
    const snap: Record<string, unknown> = {};
    for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
      (snap as Record<string, unknown>)[key] = keyholeSlot[key];
    }
    this.snapshot = snap as typeof this.snapshot;
  }

  async apply(): Promise<void> {
    const { keyholeSlot, patch } = this.opts;
    Object.assign(keyholeSlot, patch);
    if (this.opts.opfs) await this.persist();
    useAppStore.getState().boreCacheInvalidator?.([this.opts.partPath]);
  }

  async revert(): Promise<void> {
    const { keyholeSlot } = this.opts;
    Object.assign(keyholeSlot, this.snapshot);
    if (this.opts.opfs) await this.persist();
    useAppStore.getState().boreCacheInvalidator?.([this.opts.partPath]);
  }

  private async persist(): Promise<void> {
    const opfs = this.opts.opfs!;
    const bytes = await opfs.read(this.opts.partPath);
    const proj = await unpackProject(bytes);
    const manifest = proj.manifest as { document: Record<string, unknown> };
    const doc = this.opts.doc;
    if (doc.featureTree !== undefined) manifest.document.featureTree = doc.featureTree;
    const packed = await packProject({
      manifest: { ...manifest, formatVersion: CURRENT_FORMAT_VERSION },
      blobs: {},
    });
    await opfs.write(this.opts.partPath, packed);
  }
}
