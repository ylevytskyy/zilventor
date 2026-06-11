import type { Command } from './Command';
import type { BoreOp } from '@zilventor/shared';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

type OpfsRW = { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };

interface EditBoreOpts {
  bore: BoreOp;
  patch: Partial<Pick<BoreOp, 'u' | 'v' | 'diameter' | 'depth'>>;
  partPath: string;
  doc: { bores?: BoreOp[] };
  opfs: OpfsRW | null;
}

/**
 * Apply a positional/dimensional patch to a single BoreOp. Sets bore.edited=true.
 * Undoable: revert restores all patched fields + the prior value of `edited`.
 * exactOptionalPropertyTypes: if `edited` was absent before apply, revert deletes the key.
 */
export class EditBoreCommand implements Command {
  readonly name = 'EditBore';
  /** Snapshot of fields that will be overwritten, plus prior `edited` state. */
  private snapshot: Partial<Pick<BoreOp, 'u' | 'v' | 'diameter' | 'depth'>> & { hadEdited: boolean; priorEdited: boolean };

  constructor(private opts: EditBoreOpts) {
    const { bore, patch } = opts;
    const hadEdited = 'edited' in bore;
    const priorEdited = bore.edited === true;
    const snap: Record<string, unknown> = { hadEdited, priorEdited };
    for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
      (snap as Record<string, unknown>)[key] = bore[key];
    }
    this.snapshot = snap as typeof this.snapshot;
  }

  async apply(): Promise<void> {
    const { bore, patch } = this.opts;
    Object.assign(bore, patch);
    bore.edited = true;
    if (this.opts.opfs) await this.persist();
    useAppStore.getState().boreCacheInvalidator?.([this.opts.partPath]);
  }

  async revert(): Promise<void> {
    const { bore } = this.opts;
    const { hadEdited, priorEdited, ...fields } = this.snapshot;
    Object.assign(bore, fields);
    if (!hadEdited) {
      // edited key was absent before — restore absent state
      delete (bore as Record<string, unknown>).edited;
    } else {
      bore.edited = priorEdited;
    }
    if (this.opts.opfs) await this.persist();
    useAppStore.getState().boreCacheInvalidator?.([this.opts.partPath]);
  }

  private async persist(): Promise<void> {
    const opfs = this.opts.opfs!;
    const bytes = await opfs.read(this.opts.partPath);
    const proj = await unpackProject(bytes);
    const manifest = proj.manifest as { document: Record<string, unknown> };
    const doc = this.opts.doc;
    if (doc.bores !== undefined && doc.bores.length > 0) {
      manifest.document.bores = doc.bores;
    } else {
      delete manifest.document.bores;
    }
    const packed = await packProject({
      manifest: { ...manifest, formatVersion: CURRENT_FORMAT_VERSION },
      blobs: {},
    });
    await opfs.write(this.opts.partPath, packed);
  }
}
