/**
 * AddLegLevelersCommand — M4-B, Task 5.
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
 *
 * Face mapping: u = pos.x - bottomComp.position.x,
 *               v = pos.y - bottomComp.position.y  (panel-local centred coords).
 * Exact axis placement is verified in the Task 8 e2e test.
 *
 * revert(): stubs — Task 6 restores priorBottomBores to bottom panel.
 */

import type { Command } from './Command';
import type { BoreOp, FaceName } from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import { computeLegPositions, legLevelerBores } from '@zilventor/shared/src/cabinets/legLayout';
import { BUILTIN_CATALOG } from '@zilventor/shared/src/hardware/builtinCatalog';
import { unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
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

export class AddLegLevelersCommand implements Command {
  readonly name = 'AddLegLevelers';
  private readonly store: typeof useAppStore; // reserved for Task 6 revert

  /** Prior bottom-panel bores — stashed on execute() for Task 6 revert. */
  priorBottomBores: BoreOp[] = [];

  constructor(private readonly opts: {
    cabinetPath: string;
    params: AddLegLevelersParams;
    opfs: OpfsRWD;
    kernel?: KernelPartApi;
    store?: typeof useAppStore;
  }) {
    this.store = opts.store ?? useAppStore;
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

    // Map each cabinet-local (x, y) to bottom-panel-local (u, v).
    // u = pos.x - bottomComp.position.x, v = pos.y - bottomComp.position.y
    // (panel-local centred coords; exact face2DFrame placement confirmed by Task 8 e2e).
    const newBores = positions.flatMap((pos, i) => {
      const u = pos.x - bottomComp.position.x;
      const v = pos.y - bottomComp.position.y;
      return legLevelerBores({ u, v }, spec, face, `leg-${i}`);
    });

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
  }

  /** Alias for Command interface compliance. */
  async apply(): Promise<void> {
    return this.execute();
  }

  /**
   * Task 6: restore priorBottomBores to the bottom panel.
   * Stub until Task 6 implements revert.
   */
  async revert(): Promise<void> {
    // TODO(task-6): read bottomComp.partPath, restore priorBottomBores, write back.
  }
}
