/**
 * AddLegLevelersCommand — M4-B, Tasks 5 + 6.
 *
 * execute():
 *   1. Validation (all before any opfs.write — guard order matters):
 *      a. legsPerRow < 2 → throw legLeveler.error.tooFewLegs
 *      b. catalog missing legLeveler spec → throw legLeveler.error.noSpec
 *      c. deriveCabinetDims → toekickHeight ≤ 0 → throw legLeveler.error.noToekick
 *      d. 2*sideInset + patternW > width OR frontInset+backInset+patternD > depth →
 *         throw legLeveler.error.tooSmall
 *   2. computeLegPositions (2R positions in cabinet-local XY plane)
 *   3. legLevelerBores × 2R → 4*(2R) BoreOp[] on the bottom panel Bottom face
 *   4. Append to bottom panel bores, write once.
 *   5. Synthesize hardware/<skuId>.zipt once (if not yet present).
 *   6. Push 2R ComponentInstance[role:'legLeveler'] onto the cabinet assembly.
 *
 * Face mapping: u = pos.x - bottomComp.position.x,
 *               v = pos.y - bottomComp.position.y  (panel-local centred coords).
 * Exact axis placement is verified in the Task 8 e2e test.
 *
 * revert(): removes the 2R leg components added by execute() and restores
 *   priorBottomBores to the bottom panel.
 */

import type { Command } from './Command';
import type { AssemblyDocument, BoreOp, ComponentInstance, FaceName, MachiningPresetValues } from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import { computeLegPositions, legLevelerBores } from '@zilventor/shared/src/cabinets/legLayout';
import { BUILTIN_CATALOG } from '@zilventor/shared/src/hardware/builtinCatalog';
import { newPart, addFeature } from '@zilventor/kernel/src/adapter/PartDocument';
import { unpackAssembly, packAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { useAppStore } from '../store/useAppStore';
import { deriveCabinetDims } from './cabinetDims';

type OpfsRWD = {
  read(p: string): Promise<Uint8Array>;
  write(p: string, b: Uint8Array): Promise<void>;
  exists(p: string): Promise<boolean>;
  delete?(p: string): Promise<void>;
};

type KernelPartApi = {
  registerPart(part: { id: string }): Promise<void>;
  deletePart(partId: string): Promise<void>;
};

export interface AddLegLevelersParams {
  legsPerRow: number;       // R ≥ 2; total legs = 2R (front + back row)
  skuId?: string;           // default 'leg-leveler-100'
  sideInset?: number;       // default 50mm
  frontMargin?: number;     // default 25mm (added to toekickSetback)
  backInset?: number;       // default 25mm
}

/** Snapshot preset values (P9 W2b, D1) onto every generated leg-leveler bore —
 *  same shape as the shelf-pin transfer (W2a): diameter/depth/presetLayerName/
 *  toolNumber/speed all flow from the preset, mirroring
 *  ApplyMachiningPresetCommand's bore branch. */
function withPresetValues(bores: BoreOp[], preset?: MachiningPresetValues): BoreOp[] {
  if (!preset) return bores;
  return bores.map((b) => ({
    ...b,
    diameter: preset.diameter,
    depth: preset.depth,
    presetLayerName: preset.layerName,
    ...(preset.toolNumber === undefined ? {} : { toolNumber: preset.toolNumber }),
    ...(preset.speed === undefined ? {} : { speed: preset.speed }),
  }));
}

export class AddLegLevelersCommand implements Command {
  readonly name = 'AddLegLevelers';
  private readonly store: typeof useAppStore | undefined;

  /** Prior bottom-panel bores — stashed on execute() for revert. */
  priorBottomBores: BoreOp[] = [];

  /** Component ids added by execute() — used by revert() to filter them out. */
  addedComponentIds: string[] = [];

  /** Cabinet path cached from execute() so revert() can find the bottom panel. */
  private executedCabinetPath = '';

  constructor(private readonly opts: {
    cabinetPath: string;
    params: AddLegLevelersParams;
    /** Snapshotted machining-preset values (P9 W2b, ADR 0001) — VALUES, not a
     *  preset id, so editing the preset later never changes already-created bores. */
    presetValues?: MachiningPresetValues;
    opfs: OpfsRWD;
    kernel?: KernelPartApi;
    store?: typeof useAppStore;
  }) {
    // store is optional — unit tests omit it; real UI passes useAppStore
    this.store = opts.store;
  }

  async execute(): Promise<void> {
    const { cabinetPath, params, opfs } = this.opts;
    const R = params.legsPerRow;

    // ─── 1. Validation — ALL guards BEFORE any opfs.write ─────────────────────
    if (R < 2) throw new Error('legLeveler.error.tooFewLegs');

    const skuId = params.skuId ?? 'leg-leveler-100';
    const entry = BUILTIN_CATALOG.find((e) => e.id === skuId);
    if (!entry?.legLeveler) throw new Error('legLeveler.error.noSpec');
    const spec = entry.legLeveler;

    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    const dims = await deriveCabinetDims(cab, opfs);
    if (dims.toekickHeight <= 0) throw new Error('legLeveler.error.noToekick');

    const sideInset = params.sideInset ?? 50;
    const frontInset = dims.toekickSetback + (params.frontMargin ?? 25);
    const backInset = params.backInset ?? 25;

    // Fit check: leg pattern must fit inside the cabinet footprint
    if (
      2 * sideInset + spec.patternW > dims.width ||
      frontInset + backInset + spec.patternD > dims.depth
    ) {
      throw new Error('legLeveler.error.tooSmall');
    }

    // ─── 2. Compute 2R leg positions in cabinet-local XY ─────────────────────
    const positions = computeLegPositions({
      width: dims.width,
      depth: dims.depth,
      legsPerRow: R,
      sideInset,
      frontInset,
      backInset,
    });

    // ─── 3. Locate bottom panel component ────────────────────────────────────
    const bottomComp = cab.components.find((c) => c.role === 'bottom');
    if (!bottomComp) throw new Error('legLeveler.error.noBottomPanel'); // structural invariant

    const face: FaceName = { featureId: 'panel', role: 'Bottom', instance: 0 };

    // Map each cabinet-local (x, y) to bottom-panel Bottom-face (u, v).
    //
    // face2DFrame('Bottom'): origin={x:-hL,y:+hW,z:0}, uDir={x:1,y:0,z:0}, vDir={x:0,y:-1,z:0}.
    // worldPose.translation = comp.position + (hL, hW, 0)  (kernel centers the mesh geometry).
    // world.x = (comp.x + hL) + (-hL) + u        = comp.x + u
    //   → u = pos.x - comp.x  = pos.x - bottomComp.position.x           ← unchanged ✓
    // world.y = (comp.y + hW) + hW + v * (-1)    = comp.y + (D - Tb) - v
    //         = D - v  (since comp.y = Tb, the back-panel thickness)
    //   → v = dims.depth - pos.y
    // vDir = -Y means v grows toward the FRONT; confirmed by the co-location unit test.
    const newBores = withPresetValues(positions.flatMap((pos, i) => {
      const u = pos.x - bottomComp.position.x;
      const v = dims.depth - pos.y;
      return legLevelerBores({ u, v }, spec, face, `leg-${i}`, entry.id);
    }), this.opts.presetValues);

    // ─── 4. Append bores to bottom panel — one write ─────────────────────────
    const bottomPath = bottomComp.partPath;
    const project = await unpackProject(await opfs.read(bottomPath));
    const doc = (project.manifest as { document: { bores?: BoreOp[] } }).document;
    this.priorBottomBores = doc.bores ?? [];
    doc.bores = [...this.priorBottomBores, ...newBores];
    await opfs.write(bottomPath, await packProject({
      manifest: { ...(project.manifest as object), formatVersion: CURRENT_FORMAT_VERSION, document: doc },
      blobs: project.blobs ?? {},
    }));

    // ─── 5. Synthesize hardware/<skuId>.zipt once ────────────────────────────
    const legPath = `hardware/${entry.id}.zipt`;
    if (!(await opfs.exists(legPath))) {
      const hwFeature = {
        kind: 'hardware' as const,
        id: 'leg',
        hardwareSkuId: entry.id,
        bboxMm: entry.bboxMm,
        attachPoints: entry.attachPoints,
      };
      const partDoc = addFeature(newPart(entry.name), hwFeature as never);
      await opfs.write(legPath, await packProject({
        manifest: { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: partDoc },
        blobs: {},
      }));
      await this.opts.kernel?.registerPart?.({ id: entry.id });
    }

    // ─── 6. Push 2R leg ComponentInstances onto the cabinet assembly ─────────
    const ts = `LG${cab.components.length}`;
    this.addedComponentIds = [];
    for (const [i, pos] of positions.entries()) {
      const comp: ComponentInstance = {
        id: `${ts}-${i}`,
        partPath: legPath,
        position: { x: pos.x, y: pos.y, z: dims.toekickHeight - entry.bboxMm.h / 2 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
        role: 'legLeveler',
      };
      cab.components.push(comp);
      this.addedComponentIds.push(comp.id);
    }
    await opfs.write(cabinetPath, await packAssembly(cab, new Uint8Array()));
    await this.reloadCabinet(cab);
    this.store?.getState().boreCacheInvalidator?.([bottomPath]);

    // Cache for revert()
    this.executedCabinetPath = cabinetPath;
  }

  /** Alias for Command interface compliance. */
  async apply(): Promise<void> {
    return this.execute();
  }

  /**
   * Removes the 2R leg components added by execute() and restores
   * priorBottomBores to the bottom panel.
   */
  async revert(): Promise<void> {
    const { opfs } = this.opts;
    const cabinetPath = this.executedCabinetPath || this.opts.cabinetPath;

    // Remove leg components from cabinet
    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    cab.components = cab.components.filter((c) => !this.addedComponentIds.includes(c.id));
    await opfs.write(cabinetPath, await packAssembly(cab, new Uint8Array()));

    await this.reloadCabinet(cab);

    // Restore bottom-panel bores (blob-preserving)
    const bottomComp = cab.components.find((c) => c.role === 'bottom');
    if (bottomComp) {
      const proj = await unpackProject(await opfs.read(bottomComp.partPath));
      const doc = (proj.manifest as { document: { bores?: BoreOp[] } }).document;
      doc.bores = this.priorBottomBores;
      await opfs.write(bottomComp.partPath, await packProject({
        manifest: { ...(proj.manifest as object), formatVersion: CURRENT_FORMAT_VERSION, document: doc },
        blobs: proj.blobs ?? {},
      }));
      this.store?.getState().boreCacheInvalidator?.([bottomComp.partPath]);
    }
  }

  /** Refresh the cabinet entry in subAssemblyDocs and mark solver dirty. No-ops when store is absent (unit tests). */
  private async reloadCabinet(cab: AssemblyDocument): Promise<void> {
    if (!this.store) return;
    const docs = { ...this.store.getState().subAssemblyDocs };
    docs[this.opts.cabinetPath] = cab;
    this.store.getState().setSubAssemblyDocs(docs);
    this.store.getState().setSolverDirty(true);
  }
}
