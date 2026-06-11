import type { Command } from './Command';
import type { BoreOp } from '@zilventor/shared';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

type OpfsRW = { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };

type AffectedDoc = {
  partPath: string;
  doc: { bores?: BoreOp[]; suppressedConnectorIds?: string[] };
};

interface DeleteConnectorOpts {
  /** For fasteners: connectorId. For shelf-pin single-bore delete: the bore's id. */
  targetId: string;
  /** 'connector' = remove all bores with matching connectorId; 'bore' = remove single bore by id. */
  mode: 'connector' | 'bore';
  /** All docs that may contain bores with this connectorId/id. */
  affectedDocs: AffectedDoc[];
  opfs: OpfsRW | null;
}

type DocSnapshot = {
  doc: { bores?: BoreOp[]; suppressedConnectorIds?: string[] };
  partPath: string;
  priorBores: BoreOp[];
  hadSuppressed: boolean;
  priorSuppressed: string[];
  /** Prior bytes for rollback on partial write failure. */
  priorBytes: Uint8Array | null;
};

/**
 * Cross-document atomic connector/bore deletion. Removes matching bores and appends
 * targetId to suppressedConnectorIds in each affected doc.
 *
 * Absent-not-empty contract (exactOptionalPropertyTypes):
 *   - Never writes suppressedConnectorIds: [].
 *   - After revert, if suppressedConnectorIds was absent before, deletes the key.
 */
export class DeleteConnectorCommand implements Command {
  readonly name = 'DeleteConnector';
  private snapshots: DocSnapshot[] = [];

  constructor(private opts: DeleteConnectorOpts) {}

  async apply(): Promise<void> {
    // Step 1: capture snapshots.
    this.snapshots = [];
    for (const ad of this.opts.affectedDocs) {
      // Absent-not-empty contract: treat undefined or [] as "absent".
      const hadSuppressed = (ad.doc.suppressedConnectorIds !== undefined && ad.doc.suppressedConnectorIds.length > 0);
      const priorSuppressed = [...(ad.doc.suppressedConnectorIds ?? [])];
      const priorBores = [...(ad.doc.bores ?? [])];
      let priorBytes: Uint8Array | null = null;
      if (this.opts.opfs) {
        priorBytes = await this.opts.opfs.read(ad.partPath);
      }
      this.snapshots.push({
        doc: ad.doc, partPath: ad.partPath,
        priorBores, hadSuppressed, priorSuppressed, priorBytes,
      });
    }

    // Step 2: mutate in memory.
    for (const ad of this.opts.affectedDocs) {
      const { doc } = ad;
      const existing = doc.bores ?? [];
      if (this.opts.mode === 'connector') {
        doc.bores = existing.filter((b) => b.connectorId !== this.opts.targetId);
      } else {
        doc.bores = existing.filter((b) => b.id !== this.opts.targetId);
      }
      // exactOptionalPropertyTypes: absent if empty.
      if (doc.bores.length === 0) {
        delete (doc as Record<string, unknown>).bores;
      }
      // Append to suppressedConnectorIds (create if absent).
      const suppressed = doc.suppressedConnectorIds ?? [];
      if (!suppressed.includes(this.opts.targetId)) {
        suppressed.push(this.opts.targetId);
      }
      doc.suppressedConnectorIds = suppressed;
    }

    // Step 3: persist atomically.
    if (this.opts.opfs) {
      const written: Array<{ partPath: string; priorBytes: Uint8Array }> = [];
      try {
        for (const snap of this.snapshots) {
          await this.persistDoc(snap.doc, snap.partPath);
          written.push({ partPath: snap.partPath, priorBytes: snap.priorBytes! });
        }
      } catch (err) {
        // Rollback in-memory.
        for (const snap of this.snapshots) {
          if (snap.priorBores.length > 0) {
            snap.doc.bores = snap.priorBores;
          } else {
            delete (snap.doc as Record<string, unknown>).bores;
          }
          if (!snap.hadSuppressed) {
            delete (snap.doc as Record<string, unknown>).suppressedConnectorIds;
          } else {
            snap.doc.suppressedConnectorIds = snap.priorSuppressed;
          }
        }
        // Rollback written files.
        for (const w of written) {
          try { await this.opts.opfs.write(w.partPath, w.priorBytes); } catch { /* best-effort */ }
        }
        throw err;
      }
    }

    // Step 4: invalidate only after all writes succeed.
    const paths = [...new Set(this.opts.affectedDocs.map((ad) => ad.partPath))];
    useAppStore.getState().boreCacheInvalidator?.(paths);
  }

  async revert(): Promise<void> {
    for (const snap of this.snapshots) {
      if (snap.priorBores.length > 0) {
        snap.doc.bores = snap.priorBores;
      } else {
        delete (snap.doc as Record<string, unknown>).bores;
      }
      if (!snap.hadSuppressed) {
        // Key was absent before — delete it (absent-not-empty).
        delete (snap.doc as Record<string, unknown>).suppressedConnectorIds;
      } else {
        snap.doc.suppressedConnectorIds = snap.priorSuppressed;
      }
    }

    if (this.opts.opfs) {
      for (const snap of this.snapshots) {
        await this.persistDoc(snap.doc, snap.partPath);
      }
    }

    const paths = [...new Set(this.snapshots.map((s) => s.partPath))];
    if (paths.length > 0) {
      useAppStore.getState().boreCacheInvalidator?.(paths);
    }
  }

  private async persistDoc(
    doc: { bores?: BoreOp[]; suppressedConnectorIds?: string[] },
    partPath: string,
  ): Promise<void> {
    const opfs = this.opts.opfs!;
    const bytes = await opfs.read(partPath);
    const proj = await unpackProject(bytes);
    const manifest = proj.manifest as { document: Record<string, unknown> };
    // Sync bores.
    if (doc.bores !== undefined && doc.bores.length > 0) {
      manifest.document.bores = doc.bores;
    } else {
      delete manifest.document.bores;
    }
    // Sync suppressedConnectorIds (absent-not-empty).
    if (doc.suppressedConnectorIds !== undefined && doc.suppressedConnectorIds.length > 0) {
      manifest.document.suppressedConnectorIds = doc.suppressedConnectorIds;
    } else {
      delete manifest.document.suppressedConnectorIds;
    }
    const packed = await packProject({
      manifest: { ...manifest, formatVersion: CURRENT_FORMAT_VERSION },
      blobs: {},
    });
    await opfs.write(partPath, packed);
  }
}
