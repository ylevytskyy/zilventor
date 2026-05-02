import type { Command } from './Command';
import type {
  AssemblyDocument,
  ComponentInstance,
  MaterialEntry,
  PanelFeature,
  PartDocument,
} from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION, isPanelFeature, migrateManifest, type AnyManifest } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { wouldCreateCycle } from '../assembly/cycleCheck';
import type { OpfsLike } from '../assembly/SubAssemblyCache';
import {
  reconcileMaterials,
  type PanelFeatureRefRewrite,
  type PanelMaterialRef,
} from '../assembly/reconcileMaterials';
import { readTarGz, writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';

/** Optional write capability — when present we can persist material rewrites
 *  back into the part file. The standard OpfsLike doesn't declare `write`,
 *  but the existing MemOpfs/Opfs implementations both expose it. */
interface OpfsWriteCapable {
  write(path: string, bytes: Uint8Array): Promise<void>;
}

export type PlaceComponentOpts = { partPath: string; opfs?: OpfsLike };

export class PlaceComponentCommand implements Command {
  readonly name = 'PlaceComponent';
  private placedId: string | null = null;
  /** Original part bytes captured before any rewrite; used by revert. */
  private originalPartBytes: Uint8Array | null = null;
  /** Snapshot of the assembly's `materials` array prior to reconcile. */
  private priorAssemblyMaterials: MaterialEntry[] | null = null;
  constructor(private opts: PlaceComponentOpts) {}

  async apply(): Promise<void> {
    if (this.opts.partPath.endsWith('.ziasm') && this.opts.opfs) {
      const active = useAppStore.getState().activeAssembly;
      if (!active) return;
      const activeDocPath = `${active.name}.ziasm`;
      const cyclic = await wouldCreateCycle(activeDocPath, this.opts.partPath, this.opts.opfs);
      if (cyclic) {
        useAppStore.getState().setStatus(
          `Cannot place ${this.opts.partPath}: would create a sub-assembly cycle.`,
        );
        return;
      }
    }

    // Material reconciliation for panel-bearing parts.
    if (this.opts.partPath.endsWith('.zipt') && this.opts.opfs) {
      await this.reconcilePanelMaterials();
    }

    const id = `C${Date.now()}`;
    const instance: ComponentInstance = {
      id,
      partPath: this.opts.partPath,
      position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
    };
    useAppStore.getState().addComponent(instance);
    this.placedId = id;
  }

  async revert(): Promise<void> {
    if (this.placedId) {
      useAppStore.getState().removeComponent(this.placedId);
      this.placedId = null;
    }
    if (this.priorAssemblyMaterials) {
      const asm = useAppStore.getState().activeAssembly;
      if (asm) {
        const next: AssemblyDocument = { ...asm, materials: this.priorAssemblyMaterials };
        useAppStore.getState().setActiveDocument({ kind: 'assembly', document: next });
      }
      this.priorAssemblyMaterials = null;
    }
    if (this.originalPartBytes && this.opts.opfs && hasWrite(this.opts.opfs)) {
      try {
        await this.opts.opfs.write(this.opts.partPath, this.originalPartBytes);
      } catch {
        // Best-effort restore; ignore filesystem errors.
      }
      this.originalPartBytes = null;
    }
  }

  private async reconcilePanelMaterials(): Promise<void> {
    const opfs = this.opts.opfs;
    if (!opfs) return;
    if (!(await opfs.exists(this.opts.partPath))) return;

    const bytes = await opfs.read(this.opts.partPath);
    let partDoc: PartDocument;
    let originalManifest: { formatVersion: number; kind: 'part'; document: PartDocument };
    try {
      const entries = await readTarGz(bytes);
      const manifestEntry = entries.find((e) => e.name === 'manifest.json');
      if (!manifestEntry) return;
      const raw = JSON.parse(new TextDecoder().decode(manifestEntry.data));
      const migrated = migrateManifest(raw as AnyManifest);
      if ((migrated as { kind?: string }).kind !== 'part') return;
      originalManifest = migrated as unknown as typeof originalManifest;
      partDoc = originalManifest.document;
    } catch {
      // Cannot parse — let downstream loaders handle the error.
      return;
    }

    const panel = partDoc.featureTree.find((f): f is PanelFeature => isPanelFeature(f));
    if (!panel) return;

    const asm = useAppStore.getState().activeAssembly;
    if (!asm) return;

    const refs = collectPanelMaterialRefs(panel);
    const result = reconcileMaterials(partDoc.materials, asm.materials, refs);

    // Apply assembly-side updates only if reconcile produced changes.
    const asmGrew = result.updatedAssemblyMaterials.length !== asm.materials.length;
    const partRewrote =
      result.updatedPartFeatures.length > 0 ||
      result.updatedPartMaterials.length !== partDoc.materials.length;

    if (!asmGrew && !partRewrote) return;

    // Snapshot original bytes BEFORE rewriting, so revert can restore.
    this.originalPartBytes = bytes;
    this.priorAssemblyMaterials = [...asm.materials];

    if (partRewrote) {
      if (!hasWrite(opfs)) {
        // No write capability — don't mutate part on disk; still update
        // assembly registry so the place is consistent in-memory.
      } else {
        const rewrittenPart = applyRewritesInPlace(partDoc, result.updatedPartFeatures, result.updatedPartMaterials);
        const rewrittenManifest = {
          formatVersion: CURRENT_FORMAT_VERSION,
          kind: 'part' as const,
          document: rewrittenPart,
        };
        const newBytes = await packPartManifest(rewrittenManifest);
        await opfs.write(this.opts.partPath, newBytes);
      }
    }

    if (asmGrew) {
      const seen = new Set(asm.materials.map((m) => m.id));
      for (const m of result.updatedAssemblyMaterials) {
        if (!seen.has(m.id)) {
          useAppStore.getState().addMaterial(m);
        }
      }
    }
  }
}

function hasWrite(opfs: OpfsLike): opfs is OpfsLike & OpfsWriteCapable {
  return typeof (opfs as Partial<OpfsWriteCapable>).write === 'function';
}

function collectPanelMaterialRefs(panel: PanelFeature): PanelMaterialRef[] {
  const refs: PanelMaterialRef[] = [
    { panelFeatureId: panel.id, fieldKey: 'materialId', materialId: panel.materialId },
  ];
  for (const k of ['front', 'back', 'left', 'right'] as const) {
    const band = panel.edgeBands[k];
    if (band) {
      refs.push({
        panelFeatureId: panel.id,
        fieldKey: `edgeBands.${k}.materialId` as const,
        materialId: band.materialId,
      });
    }
  }
  return refs;
}

function applyRewritesInPlace(
  part: PartDocument,
  rewrites: readonly PanelFeatureRefRewrite[],
  newPartMaterials: readonly MaterialEntry[],
): PartDocument {
  if (rewrites.length === 0) {
    return { ...part, materials: [...newPartMaterials] };
  }
  const tree = part.featureTree.map((f) => {
    if (!isPanelFeature(f)) return f;
    let next: PanelFeature = f;
    for (const r of rewrites) {
      if (r.panelFeatureId !== f.id) continue;
      if (r.fieldKey === 'materialId') {
        next = { ...next, materialId: r.newMaterialId };
      } else if (r.fieldKey.startsWith('edgeBands.')) {
        const key = r.fieldKey.slice('edgeBands.'.length, -'.materialId'.length) as
          'front' | 'back' | 'left' | 'right';
        const band = next.edgeBands[key];
        if (band) {
          next = {
            ...next,
            edgeBands: { ...next.edgeBands, [key]: { materialId: r.newMaterialId } },
          };
        }
      }
    }
    return next;
  });
  return { ...part, featureTree: tree, materials: [...newPartMaterials] };
}

async function packPartManifest(
  manifest: { formatVersion: number; kind: 'part'; document: PartDocument },
): Promise<Uint8Array> {
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  return writeTarGz([{ name: 'manifest.json', data: manifestBytes }]);
}
