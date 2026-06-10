import type { Command } from './Command';
import type { BoreOp } from '@zilventor/shared';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';

type OpfsRW = { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };

interface ClearBoresOpts {
  doc: { bores?: BoreOp[] };
  partPath: string;
  opfs: OpfsRW;
}

/**
 * Wipe all BoreOp entries from a panel document. Undoable: revert restores the prior bores[].
 * exactOptionalPropertyTypes contract: bores key is ABSENT (not []) when cleared.
 */
export class ClearBoresCommand implements Command {
  readonly name = 'ClearBores';
  private snapshot: BoreOp[];
  constructor(private opts: ClearBoresOpts) {
    this.snapshot = [...(opts.doc.bores ?? [])];
  }

  async apply(): Promise<void> {
    // Set to empty array in memory (callers checking .bores?.length work correctly).
    // The persist() writes the document with the bores key ABSENT (exactOptionalPropertyTypes contract).
    this.opts.doc.bores = [];
    // Persist if opfs is available (null in unit tests).
    if (this.opts.opfs) await this.persist();
  }

  async revert(): Promise<void> {
    if (this.snapshot.length > 0) {
      this.opts.doc.bores = [...this.snapshot];
    } else {
      // exactOptionalPropertyTypes: absent, not [].
      delete this.opts.doc.bores;
    }
    if (this.opts.opfs) await this.persist();
  }

  private async persist(): Promise<void> {
    const bytes = await this.opts.opfs.read(this.opts.partPath);
    const proj = await unpackProject(bytes);
    const manifest = proj.manifest as { document: Record<string, unknown> };
    // Sync the current state of doc.bores into the packed manifest.
    if (this.opts.doc.bores !== undefined && this.opts.doc.bores.length > 0) {
      manifest.document.bores = this.opts.doc.bores;
    } else {
      delete manifest.document.bores;
    }
    const packed = await packProject({
      manifest: { ...manifest, formatVersion: CURRENT_FORMAT_VERSION },
      blobs: {},
    });
    await this.opts.opfs.write(this.opts.partPath, packed);
  }
}
