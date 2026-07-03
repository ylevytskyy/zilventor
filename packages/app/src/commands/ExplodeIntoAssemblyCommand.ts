import type { Command } from './Command';
import type { KernelApi } from '@zilventor/kernel/src/api';
import type { AssemblyDocument, ComponentColor, ComponentInstance, ImportedFeature } from '@zilventor/shared';
import { useAppStore, type ActiveDocument } from '../store/useAppStore';
import i18n from '../i18n';
import { buildImportedPartDocument } from '../import/buildImportedPartDocument';
import { dedupeName } from '../import/dedupeName';
import type { OpfsLike } from './ImportStepAsComponentCommand';

export type ExplodeIntoAssemblyOpts = {
  kernel: Pick<KernelApi, 'splitImportedShape' | 'registerPart' | 'saveToBytes' | 'deletePart'>;
  opfs: OpfsLike;
};

/**
 * Atomic command: convert the active imported PART into an ASSEMBLY.
 * Calls kernel.splitImportedShape on the part's bodyRef → gets N solids + optional surfaces blob.
 * Creates one PartDocument + OPFS archive per solid, plus one for surfaces if non-null.
 * Builds an AssemblyDocument with all components at identity pose (native STEP coords).
 *
 * Undo: restores the prior active document; deletes all created parts from kernel + OPFS.
 *
 * Redo: re-runs splitImportedShape (no redoState optimisation like ImportStepAsComponentCommand);
 * relies on the original imported blob surviving in importedShapeCache (deletePart does NOT evict
 * it), so redo works correctly but does re-run OCCT split.
 */
export class ExplodeIntoAssemblyCommand implements Command {
  readonly name = 'ExplodeIntoAssembly';

  private priorActiveDocument: ActiveDocument | null = null;
  private createdPartIds: string[] = [];
  private createdPartPaths: string[] = [];

  constructor(private readonly opts: ExplodeIntoAssemblyOpts) {}

  async apply(): Promise<void> {
    const { kernel, opfs } = this.opts;
    const state = useAppStore.getState();

    // Guard: must have an active part
    if (!state.activePart || state.activeDocument?.kind !== 'part') {
      throw new Error('ExplodeIntoAssembly: no active imported part');
    }

    const part = state.activePart;

    // Guard: active part must have an imported feature
    const importedFeature = part.featureTree.find(
      (f): f is ImportedFeature => f.kind === 'imported',
    );
    if (!importedFeature) {
      throw new Error('ExplodeIntoAssembly: no imported feature on active part');
    }

    // Save prior state for revert
    this.priorActiveDocument = state.activeDocument;
    this.createdPartIds = [];
    this.createdPartPaths = [];

    const base = part.name;
    const sourceStep = importedFeature.sourceStep;

    // Split the imported shape into solids + optional surfaces blob
    const { solids, surfaces } = await kernel.splitImportedShape(importedFeature.bodyRef);

    // Collect existing OPFS names (without .zipt) to avoid collisions
    const existing = (await opfs.listAll())
      .filter((p) => p.endsWith('.zipt'))
      .map((p) => p.replace(/\.zipt$/, ''));
    // Track names allocated in this run to avoid intra-batch collisions
    const allocatedNames: string[] = [];

    /** Deduped helper: resolve a candidate name against OPFS + already-allocated names */
    function resolveName(candidate: string): string {
      return dedupeName(candidate, [...existing, ...allocatedNames]);
    }

    // Build parts for each solid
    const components: ComponentInstance[] = [];

    try {
      for (let i = 0; i < solids.length; i++) {
        const solid = solids[i]!;
        // N===1: bare base name; N>1: base_1..N (aligned with importStepIntoNewParts)
        const candidate = solids.length === 1 ? base : `${base}_${i + 1}`;
        const name = resolveName(candidate);
        allocatedNames.push(name);
        const partPath = `${name}.zipt`;
        const partDoc = buildImportedPartDocument(name, solid.brepBlobId, sourceStep, undefined, solid.color, undefined, solid.isManifold);
        await kernel.registerPart(partDoc);
        const bytes = await kernel.saveToBytes(partDoc.id);
        await opfs.write(partPath, bytes);
        this.createdPartIds.push(partDoc.id);
        this.createdPartPaths.push(partPath);
        components.push(makeOriginInstance(partPath, partDoc.color));
      }

      // Surfaces component (if present) — always <base>_surfaces, deduped
      if (surfaces !== null) {
        const candidate = `${base}_surfaces`;
        const name = resolveName(candidate);
        allocatedNames.push(name);
        const partPath = `${name}.zipt`;
        const partDoc = buildImportedPartDocument(name, surfaces.brepBlobId, sourceStep);
        await kernel.registerPart(partDoc);
        const bytes = await kernel.saveToBytes(partDoc.id);
        await opfs.write(partPath, bytes);
        this.createdPartIds.push(partDoc.id);
        this.createdPartPaths.push(partPath);
        components.push(makeOriginInstance(partPath));
      }
    } catch (err) {
      // Atomic abort: clean up everything created so far
      for (const partId of this.createdPartIds) {
        try { await kernel.deletePart(partId); } catch { /* best-effort */ }
      }
      for (const partPath of this.createdPartPaths) {
        try { await opfs.delete(partPath); } catch { /* best-effort */ }
      }
      this.createdPartIds = [];
      this.createdPartPaths = [];
      this.priorActiveDocument = null;
      throw err;
    }

    // Build the assembly document
    const assembly: AssemblyDocument = {
      id: crypto.randomUUID(),
      name: base,
      units: 'mm',
      parameters: {},
      components,
      constraints: [],
      groundedComponentPaths: [],
      colors: {},
      bomItemNumbers: {},
      cutListItemNumbers: {},
      colorOverrides: {},
      properties: {},
      materials: [],
      hardware: [],
    };

    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: assembly });
    useAppStore.getState().setStatus(
      i18n.t('status.explode.done', { base, count: components.length }),
    );
  }

  async revert(): Promise<void> {
    const { kernel, opfs } = this.opts;

    // Restore prior active document
    useAppStore.getState().setActiveDocument(this.priorActiveDocument);

    // Delete all created parts from kernel + OPFS (best-effort)
    for (const partId of this.createdPartIds) {
      try { await kernel.deletePart(partId); } catch { /* best-effort */ }
    }
    for (const partPath of this.createdPartPaths) {
      try { await opfs.delete(partPath); } catch { /* best-effort */ }
    }

    this.createdPartIds = [];
    this.createdPartPaths = [];
    this.priorActiveDocument = null;
  }
}

// ---------- helpers ----------------------------------------------------------

function makeOriginInstance(partPath: string, color?: ComponentColor): ComponentInstance {
  return {
    id: `comp-${crypto.randomUUID()}`,
    partPath,
    position: { x: 0, y: 0, z: 0 },
    rotation: { rx: 0, ry: 0, rz: 0 },
    visible: true,
    ...(color ? { color } : {}),
  };
}
