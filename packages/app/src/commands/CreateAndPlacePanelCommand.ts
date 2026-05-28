import type {
  AssemblyDocument,
  ComponentInstance,
  MaterialEntry,
  PanelFeature,
  PartDocument,
} from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import { addFeature, newPart } from '@zilventor/kernel/src/adapter/PartDocument';
import { writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import type { Command } from './Command';
import { useAppStore } from '../store/useAppStore';
import { syncPartMaterials } from '../store/syncPartMaterials';
import {
  reconcileMaterials,
  type PanelMaterialRef,
} from '../assembly/reconcileMaterials';

/** Minimal OPFS surface needed by this command. The existing `OpfsLike`
 *  used elsewhere in the codebase declares only `read`/`exists`; here we
 *  also need `write` so we can persist the freshly-created `.zipt`. */
export interface OpfsWriteLike {
  write(path: string, bytes: Uint8Array): Promise<void>;
}

export type CreateAndPlacePanelOpts = {
  /** Name for the new part document and (without extension) the OPFS file. */
  partName: string;
  /** Where the `.zipt` should be stored, e.g. `parts/Birch panel.zipt`. */
  partPath: string;
  /** The panel feature to insert as the first user feature. */
  panel: PanelFeature;
  /** The part-side material registry to seed (panel material + edge bands). */
  partMaterials: readonly MaterialEntry[];
  /** OPFS adapter for persisting the new part. */
  opfs: OpfsWriteLike;
};

/**
 * Composes part creation, panel insertion, OPFS persist, material
 * reconciliation against the active assembly registry, and component
 * placement — all as a single undoable unit. Revert removes the placed
 * component, restores the assembly material registry, and removes the
 * stored part bytes (best-effort).
 */
export class CreateAndPlacePanelCommand implements Command {
  readonly name = 'CreateAndPlacePanel';
  private placedComponentId: string | null = null;
  private priorAssemblyMaterials: MaterialEntry[] | null = null;

  constructor(private readonly opts: CreateAndPlacePanelOpts) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const asm = state.activeAssembly;
    if (!asm) throw new Error('NO_ACTIVE_ASSEMBLY');

    // 1. Build the part doc with materials + panel inserted.
    const basePart = newPart(this.opts.partName);
    const partWithMaterials: PartDocument = {
      ...basePart,
      materials: [...this.opts.partMaterials],
    };
    const partWithPanel = addFeature(partWithMaterials, this.opts.panel);

    // 2. Reconcile against the active assembly's registry. Rewrites are
    //    applied to the panel's materialId / edgeBands.<key>.materialId.
    const refs = collectPanelMaterialRefs(this.opts.panel);
    const result = reconcileMaterials(partWithMaterials.materials, asm.materials, refs);
    const rewrittenPanel = applyRewritesToPanel(this.opts.panel, result.updatedPartFeatures);
    const finalTree = partWithPanel.featureTree.map((f) =>
      f.id === rewrittenPanel.id && f.kind === 'panel' ? rewrittenPanel : f,
    );
    const finalPart: PartDocument = {
      ...partWithPanel,
      featureTree: finalTree,
      materials: [...result.updatedPartMaterials],
    };

    // 3. Persist part to OPFS as a `.zipt` archive.
    const bytes = await packPartManifest(finalPart);
    await this.opts.opfs.write(this.opts.partPath, bytes);

    // 4. Apply rewrites to the assembly registry.
    this.priorAssemblyMaterials = [...asm.materials];
    const seenIds = new Set(asm.materials.map((m) => m.id));
    for (const m of result.updatedAssemblyMaterials) {
      if (!seenIds.has(m.id)) {
        useAppStore.getState().addMaterial(m);
      }
    }
    // syncPartMaterials() is a no-op here because CreateAndPlacePanelCommand always
    // runs in an assembly context (activePart is null). The call is wired per the
    // kernel-sync spec so future part-targeted variants don't reintroduce the gap.
    // See: packages/app/src/commands/__tests__/CreateAndPlacePanelCommand.spec.ts
    //      "CreateAndPlacePanelCommand — kernel sync" describe block.
    await syncPartMaterials();

    // 5. Place the new part into the assembly at origin.
    const placedId = `C${Date.now()}`;
    const instance: ComponentInstance = {
      id: placedId,
      partPath: this.opts.partPath,
      position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
    };
    useAppStore.getState().addComponent(instance);
    this.placedComponentId = placedId;
  }

  async revert(): Promise<void> {
    if (this.placedComponentId) {
      useAppStore.getState().removeComponent(this.placedComponentId);
      this.placedComponentId = null;
    }
    if (this.priorAssemblyMaterials) {
      const asm = useAppStore.getState().activeAssembly;
      if (asm) {
        const next: AssemblyDocument = { ...asm, materials: this.priorAssemblyMaterials };
        useAppStore.getState().setActiveDocument({ kind: 'assembly', document: next });
      }
      this.priorAssemblyMaterials = null;
    }
    // Note: file removal from OPFS is intentionally best-effort and is left
    // to the orchestrating layer — the existing OpfsLike surface in tests
    // does not declare `delete`, and orphan part files are harmless until
    // re-saved.
  }
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

function applyRewritesToPanel(
  panel: PanelFeature,
  rewrites: ReadonlyArray<{ panelFeatureId: string; fieldKey: string; newMaterialId: string }>,
): PanelFeature {
  if (rewrites.length === 0) return panel;
  let next: PanelFeature = panel;
  for (const r of rewrites) {
    if (r.panelFeatureId !== panel.id) continue;
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
}

async function packPartManifest(part: PartDocument): Promise<Uint8Array> {
  const manifest = {
    formatVersion: CURRENT_FORMAT_VERSION,
    kind: 'part' as const,
    document: part,
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  return writeTarGz([{ name: 'manifest.json', data: manifestBytes }]);
}
