import type { Command } from './Command';
import type { BoreOp } from '@zilventor/shared';
import { flipBoreFace } from '@zilventor/shared';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

type OpfsRW = { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };

interface FlipBoreFaceOpts {
  bore: BoreOp;
  panelDims: { length: number; width: number; thickness: number };
  partPath: string;
  doc: { bores?: BoreOp[] };
  opfs: OpfsRW | null;
}

/**
 * Flip a single BoreOp's face Top<->Bottom (mirrored v) via shared's flipBoreFace.
 * Separate from EditBoreCommand: face/u/v/edited change together atomically and
 * the DXF layer bucket moves. No-op (Front/Back/Left/Right) does not mutate,
 * persist, or invalidate.
 * Undoable: revert restores face/u/v + prior `edited` state.
 * exactOptionalPropertyTypes: if `edited` was absent before apply, revert deletes the key.
 */
export class FlipBoreFaceCommand implements Command {
  readonly name = 'FlipBoreFace';
  private snapshot: { face: BoreOp['face']; u: number; v: number; hadEdited: boolean; priorEdited: boolean };
  /** Whether the bore's role at construction time is Top/Bottom (flippable). Front/Back/Left/Right → no-op for both apply and revert. */
  private flippable: boolean;

  constructor(private opts: FlipBoreFaceOpts) {
    const { bore } = opts;
    this.flippable = bore.face.role === 'Top' || bore.face.role === 'Bottom';
    this.snapshot = {
      face: { ...bore.face },
      u: bore.u,
      v: bore.v,
      hadEdited: 'edited' in bore,
      priorEdited: bore.edited === true,
    };
  }

  async apply(): Promise<void> {
    if (!this.flippable) return;
    const { bore, panelDims } = this.opts;
    const flipped = flipBoreFace(bore, panelDims);
    bore.face = flipped.face;
    bore.u = flipped.u;
    bore.v = flipped.v;
    bore.edited = true;
    if (this.opts.opfs) await this.persist();
    useAppStore.getState().boreCacheInvalidator?.([this.opts.partPath]);
  }

  async revert(): Promise<void> {
    if (!this.flippable) return;
    const { bore } = this.opts;
    const { face, u, v, hadEdited, priorEdited } = this.snapshot;
    bore.face = { ...face };
    bore.u = u;
    bore.v = v;
    if (!hadEdited) {
      delete (bore as unknown as Record<string, unknown>).edited;
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
