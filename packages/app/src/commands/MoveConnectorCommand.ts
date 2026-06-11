import type { Command } from './Command';
import type { BoreOp } from '@zilventor/shared';
import { translateConnectorAlong, CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { useAppStore } from '../store/useAppStore';

type OpfsRW = { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };

interface MemberOpts {
  bore: BoreOp;
  partPath: string;
  doc: { bores?: BoreOp[] };
  panelDims: { length: number; width: number; thickness: number };
  worldPose: { translation: { x: number; y: number; z: number }; quaternion: [number, number, number, number] };
}

interface MoveConnectorOpts {
  members: MemberOpts[];
  worldDir: { x: number; y: number; z: number };
  delta: number;
  opfs: OpfsRW | null;
}

type MemberSnapshot = {
  bore: BoreOp;
  partPath: string;
  doc: { bores?: BoreOp[] };
  priorU: number;
  priorV: number;
  hadEdited: boolean;
  priorEdited: boolean;
  /** Original packed bytes of the .zipt BEFORE apply — used for rollback on partial write failure. */
  priorBytes: Uint8Array | null;
};

/**
 * Cross-document atomic connector move. Calls translateConnectorAlong on all members,
 * sets edited=true on each, writes doc1 then doc2, rolls back both on any failure,
 * then invalidates all caches. On revert: restores snapshots for all docs, writes all, invalidates.
 */
export class MoveConnectorCommand implements Command {
  readonly name = 'MoveConnector';
  private snapshots: MemberSnapshot[] = [];

  constructor(private opts: MoveConnectorOpts) {}

  async apply(): Promise<void> {
    // Step 1: capture snapshots + prior bytes for all members.
    this.snapshots = [];
    for (const m of this.opts.members) {
      const hadEdited = 'edited' in m.bore;
      const priorEdited = m.bore.edited === true;
      let priorBytes: Uint8Array | null = null;
      if (this.opts.opfs) {
        priorBytes = await this.opts.opfs.read(m.partPath);
      }
      this.snapshots.push({
        bore: m.bore, partPath: m.partPath, doc: m.doc,
        priorU: m.bore.u, priorV: m.bore.v,
        hadEdited, priorEdited,
        priorBytes,
      });
    }

    // Step 2: mutate all bores in memory.
    translateConnectorAlong(
      this.opts.members.map((m) => ({ bore: m.bore, panelDims: m.panelDims, worldPose: m.worldPose })),
      this.opts.worldDir,
      this.opts.delta,
    );
    for (const m of this.opts.members) {
      m.bore.edited = true;
    }

    // Step 3: persist each doc atomically (rollback all on any failure).
    if (this.opts.opfs) {
      const written: Array<{ partPath: string; priorBytes: Uint8Array }> = [];
      try {
        for (const snap of this.snapshots) {
          await this.persistDoc(snap.doc, snap.partPath);
          written.push({ partPath: snap.partPath, priorBytes: snap.priorBytes! });
        }
      } catch (err) {
        // Roll back in-memory mutations.
        for (const snap of this.snapshots) {
          snap.bore.u = snap.priorU;
          snap.bore.v = snap.priorV;
          if (!snap.hadEdited) {
            delete (snap.bore as Record<string, unknown>).edited;
          } else {
            snap.bore.edited = snap.priorEdited;
          }
        }
        // Roll back written files (restore pre-command bytes).
        for (const w of written) {
          try { await this.opts.opfs.write(w.partPath, w.priorBytes); } catch { /* best-effort */ }
        }
        throw err;
      }
    }

    // Step 4: invalidate caches only after ALL writes succeed.
    const paths = [...new Set(this.opts.members.map((m) => m.partPath))];
    useAppStore.getState().boreCacheInvalidator?.(paths);
  }

  async revert(): Promise<void> {
    // Restore in-memory.
    for (const snap of this.snapshots) {
      snap.bore.u = snap.priorU;
      snap.bore.v = snap.priorV;
      if (!snap.hadEdited) {
        delete (snap.bore as Record<string, unknown>).edited;
      } else {
        snap.bore.edited = snap.priorEdited;
      }
    }

    // Persist.
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

  private async persistDoc(doc: { bores?: BoreOp[] }, partPath: string): Promise<void> {
    const opfs = this.opts.opfs!;
    const bytes = await opfs.read(partPath);
    const proj = await unpackProject(bytes);
    const manifest = proj.manifest as { document: Record<string, unknown> };
    if (doc.bores !== undefined && doc.bores.length > 0) {
      manifest.document.bores = doc.bores;
    } else {
      delete manifest.document.bores;
    }
    const packed = await packProject({
      manifest: { ...manifest, formatVersion: CURRENT_FORMAT_VERSION },
      blobs: {},
    });
    await opfs.write(partPath, packed);
  }
}
