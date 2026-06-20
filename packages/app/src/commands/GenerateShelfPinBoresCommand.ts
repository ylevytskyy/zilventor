import type { Command } from './Command';
import type { AssemblyDocument, BoreOp, ShelfPinParams } from '@zilventor/shared';
import {
  shelfPinGrid,
  CURRENT_FORMAT_VERSION,
  LEFT_SIDE_INNER_FACE,
  RIGHT_SIDE_INNER_FACE,
  mergeBores,
} from '@zilventor/shared';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
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

export class GenerateShelfPinBoresCommand implements Command {
  readonly name = 'GenerateShelfPinBores';
  /** partPath → prior bores[] (for revert). Captured during apply(). */
  private priorBores = new Map<string, BoreOp[]>();
  /** partPath → prior shelfPinParams (or undefined if absent). Captured during apply(). */
  private priorParams = new Map<string, ShelfPinParams | undefined>();
  private readonly store: typeof useAppStore;

  constructor(private readonly opts: {
    cabinetPath?: string; // reserved: explicit cabinet override (unused in v1 — recurse activeAssembly)
    params: ShelfPinParams;
    opfs: OpfsRW;
    store?: typeof useAppStore;
  }) {
    this.store = opts.store ?? useAppStore;
  }

  async apply(): Promise<void> {
    const asm = this.store.getState().activeAssembly;
    if (!asm) return;

    // partPath → loaded {manifest, document}, shared across cabinet groups.
    const docs = new Map<string, { manifest: Record<string, unknown>; document: Record<string, unknown> }>();
    // partPath → accumulated new bores.
    const accum = new Map<string, BoreOp[]>();
    const appendBores = (partPath: string, bores: BoreOp[]) => {
      const list = accum.get(partPath) ?? [];
      list.push(...bores);
      accum.set(partPath, list);
    };

    // Recurse nested .ziasm sub-assemblies; drill every leftSide/rightSide panel.
    const processAssemblyDoc = async (doc: AssemblyDocument): Promise<void> => {
      for (const c of doc.components) {
        if (c.partPath.endsWith('.ziasm')) {
          const subDoc = await unpackAssembly(await this.opts.opfs.read(c.partPath));
          await processAssemblyDoc(subDoc);
          continue;
        }
        if (c.role !== 'leftSide' && c.role !== 'rightSide') continue;

        if (!docs.has(c.partPath)) {
          const project = await this.opts.opfs.read(c.partPath).then(unpackProject);
          const manifest = project.manifest as { document: Record<string, unknown> };
          docs.set(c.partPath, { manifest: manifest as unknown as Record<string, unknown>, document: manifest.document });
        }
        const entry = docs.get(c.partPath)!;
        // UNSWAPPED native dims — shelfPinGrid authors (u,v) against these directly
        // (Convention 1). Do NOT swap L↔T here; that swap is joint-math only.
        const dims = panelDimsFromDoc(entry.document as { featureTree?: Array<Record<string, unknown>> });
        // Inner face IMPORTED from prisadkaFaceConventions (Phase 0 derives + proves the sign).
        // NEVER re-declare local literals — they would break the single-source-of-truth
        // and reproduce the slice-1 false-green face-sign class.
        const innerFace = c.role === 'leftSide' ? LEFT_SIDE_INNER_FACE : RIGHT_SIDE_INNER_FACE;
        appendBores(c.partPath, shelfPinGrid(dims, innerFace, this.opts.params));
      }
    };

    await processAssemblyDoc(asm);

    // Persist: snapshot prior bores, replace-with-merge, repack each .zipt.
    for (const [partPath, newBores] of accum) {
      const entry = docs.get(partPath)!;
      const existing = (entry.document.bores as BoreOp[] | undefined) ?? [];
      this.priorBores.set(partPath, existing);
      const suppressed = (entry.document.suppressedConnectorIds as string[] | undefined);
      const merged = mergeBores(newBores, existing, suppressed);
      if (merged.length > 0) {
        entry.document.bores = merged;
      } else {
        delete (entry.document as Record<string, unknown>).bores;
      }
      // Persist the grid params so a later start-offset tweak re-runs without
      // resetting custom pitch/setbacks. Snapshot the prior value for revert.
      this.priorParams.set(partPath, entry.document.shelfPinParams as ShelfPinParams | undefined);
      entry.document.shelfPinParams = this.opts.params;
      const repackedManifest = {
        ...entry.manifest,
        formatVersion: CURRENT_FORMAT_VERSION,
        document: entry.document,
      };
      await this.opts.opfs.write(
        partPath,
        await packProject({ manifest: repackedManifest, blobs: {} }),
      );
    }

    const affectedPaths = [...this.priorBores.keys()];
    if (affectedPaths.length > 0) {
      this.store.getState().boreCacheInvalidator?.(affectedPaths);
    }
  }

  /** Returns the part paths that were written during the most recent apply(). */
  getAffectedPartPaths(): string[] {
    return [...this.priorBores.keys()];
  }

  async revert(): Promise<void> {
    const affectedPaths = [...this.priorBores.keys()];
    for (const [partPath, prior] of this.priorBores) {
      const project = await this.opts.opfs.read(partPath).then(unpackProject);
      const manifest = project.manifest as { document: Record<string, unknown> };
      if (prior.length > 0) {
        manifest.document.bores = prior;
      } else {
        delete manifest.document.bores;
      }
      const priorP = this.priorParams.get(partPath);
      if (priorP !== undefined) {
        manifest.document.shelfPinParams = priorP;
      } else {
        delete (manifest.document as Record<string, unknown>).shelfPinParams;
      }
      await this.opts.opfs.write(
        partPath,
        await packProject({
          manifest: { ...manifest, formatVersion: CURRENT_FORMAT_VERSION },
          blobs: {},
        }),
      );
    }
    this.priorBores.clear();
    this.priorParams.clear();
    if (affectedPaths.length > 0) {
      this.store.getState().boreCacheInvalidator?.(affectedPaths);
    }
  }
}
