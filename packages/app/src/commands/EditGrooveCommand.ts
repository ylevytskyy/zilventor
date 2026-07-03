import type { Command } from './Command';
import type { GrooveFeature, GrooveSpec, Feature } from '@zilventor/shared';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

type OpfsRW = { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };

interface EditGrooveOpts {
  groove: GrooveFeature;
  patch: Partial<Pick<GrooveSpec, 'faceRole' | 'axis' | 'position' | 'width' | 'depth'>>;
  partPath: string;
  doc: { featureTree?: Feature[] };
  opfs: OpfsRW | null;
}

/**
 * Apply a positional/dimensional patch to a single GrooveFeature in place.
 * All patchable fields (faceRole/axis/position/width/depth) are required on
 * GrooveSpec, so no absence-tracking is needed (unlike EditBoreCommand's
 * `edited` flag). The kernel's executeTree re-cuts the groove from these
 * fields on every rebuild — mutating the live feature + invalidating panel
 * caches is sufficient; no explicit re-execute call here.
 * Undoable: revert restores the prior value of every patched field.
 */
export class EditGrooveCommand implements Command {
  readonly name = 'EditGroove';
  /** Snapshot of only the fields present in `patch`, prior to apply. */
  private snapshot: Partial<Pick<GrooveSpec, 'faceRole' | 'axis' | 'position' | 'width' | 'depth'>>;

  constructor(private opts: EditGrooveOpts) {
    const { groove, patch } = opts;
    const snap: Record<string, unknown> = {};
    for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
      (snap as Record<string, unknown>)[key] = groove[key];
    }
    this.snapshot = snap as typeof this.snapshot;
  }

  async apply(): Promise<void> {
    const { groove, patch } = this.opts;
    Object.assign(groove, patch);
    if (this.opts.opfs) await this.persist();
    useAppStore.getState().boreCacheInvalidator?.([this.opts.partPath]);
  }

  async revert(): Promise<void> {
    const { groove } = this.opts;
    Object.assign(groove, this.snapshot);
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
