/**
 * AddDrawerBankCommand — Chunk H, присадка slice 4.
 *
 * apply():
 *   1. Unpack cabinet .ziasm + deriveCabinetDims.
 *   2. Degenerate guard (§14.3 / C-8): block openW ≤ 57 OR slotH ≤ 24 OR count < 1.
 *   3. drawerBankLayout → N equal slots.
 *   4. Per slot:
 *      a. drawerFrontMath → write front .zipt (registerPart, dedupeName).
 *      b. drawerBoxMath → buildDrawerBox (5 panel .zipt + box .ziasm, registerPart each).
 *      c. drawerSlideMath → writeBoxSideBores into the box side panels
 *                         → append cabinet-side bores to cabinet L/R side .zipt (snapshot priors).
 *   5. Push N drawerFront + N drawerBox components into cab.components (unique dedupeName paths).
 *   6. packAssembly + write cabinet + reloadCabinet.
 *
 * revert():
 *   Remove created components, restoreBoxSideBores, restore cabinet-side prior bores,
 *   opfs.delete all written front .zipt + box .ziasm + box panel .zipt, deletePart from kernel,
 *   repack + reload.
 *
 * Architecture: clone-of-pattern from AddDoorCommand (§14.5 reuse premise).
 * Correction C-5: box = 5 separate panel .zipt files + 1 box .ziasm via buildDrawerBox.
 * Correction C-6: FULL AssemblyDocument seed required in tests (not bare makeAsm).
 * Correction C-8: degenerate guard fires BEFORE writing anything.
 * Correction C-9: opfs.delete? is optional — call await opfs.delete?.(path).
 */

import type { Command } from './Command';
import type {
  AssemblyDocument,
  BoreOp,
  ComponentInstance,
  PanelFeature,
  PartDocument,
} from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import {
  LEFT_SIDE_INNER_FACE,
  RIGHT_SIDE_INNER_FACE,
} from '@zilventor/shared';
import { newPart, addFeature } from '@zilventor/kernel/src/adapter/PartDocument';
import { packAssembly, unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { dedupeName } from '../import/dedupeName';
import { useAppStore } from '../store/useAppStore';
import { deriveCabinetDims } from './cabinetDims';
import { buildDrawerBox, writeBoxSideBores } from './buildDrawerBox';
import { buildSlidePart, DEFAULT_DRAWER_SLIDE_SKU } from './buildSlidePart';
import { drawerBankLayout } from '@zilventor/shared/src/drawerBankLayout';
import { drawerFrontMath } from '@zilventor/shared/src/drawerFrontMath';
import { drawerBoxMath } from '@zilventor/shared/src/drawerBoxMath';
import { drawerSlideMath } from '@zilventor/shared/src/drawerSlideMath';
import { writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';

type OpfsRWD = {
  read(p: string): Promise<Uint8Array>;
  write(p: string, b: Uint8Array): Promise<void>;
  exists(p: string): Promise<boolean>;
  delete?(p: string): Promise<void>;
};

type KernelPartApi = {
  registerPart(part: PartDocument): Promise<void>;
  deletePart(partId: string): Promise<void>;
};

export interface AddDrawerBankParams {
  count: number;
  overlay: 'full' | 'half' | 'inset';
  thickness: number;
  heights?: number[];
}

/** Artifacts created for one drawer slot during apply(). */
interface DrawerArtifacts {
  /** Front .zipt OPFS path */
  frontPath: string;
  /** Front PartDocument id (for kernel deletePart) */
  frontPartId: string;
  /** Front component pushed into the cabinet */
  frontComponent: ComponentInstance;

  /** Box .ziasm OPFS path */
  boxPath: string;
  /** Box panel .zipt OPFS paths (5 panels) */
  boxPanelPaths: string[];
  /** Box panel PartDocument ids (for kernel deletePart) */
  boxPanelPartIds: string[];
  /** Box component pushed into the cabinet */
  boxComponent: ComponentInstance;

  /** Drawer-slide hardware component pushed into the cabinet (1b.5.3) */
  slideComponent: ComponentInstance;
}

export class AddDrawerBankCommand implements Command {
  readonly name = 'AddDrawerBank';
  private readonly store: typeof useAppStore;

  /** Artifacts created on first apply() — replayed on redo. */
  private artifacts: DrawerArtifacts[] | null = null;

  /** sidePanelPath → prior BoreOp[] snapshot (cabinet-side, before apply appended). */
  private priorCabinetSideBores = new Map<string, BoreOp[]>();

  constructor(private readonly opts: {
    cabinetPath: string;
    params: AddDrawerBankParams;
    opfs: OpfsRWD;
    kernel?: KernelPartApi;
    store?: typeof useAppStore;
  }) {
    this.store = opts.store ?? useAppStore;
  }

  async apply(): Promise<void> {
    const { cabinetPath, params, opfs, kernel } = this.opts;
    const N = params.count;

    // ─── 1. Unpack cabinet + derive dims ──────────────────────────────────────
    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    const dims = await deriveCabinetDims(cab, opfs);

    // ─── 2. Degenerate guard (§14.3 / C-8) ───────────────────────────────────
    const openW = dims.width - 2 * dims.Tc;
    const openH = dims.height - dims.toekickHeight - 2 * dims.Tc;
    const openBottomZ = dims.toekickHeight + dims.Tc;
    const innerD = dims.depth; // side panel width = full cabinet depth
    const frontY = dims.depth; // front face of cabinet

    if (N < 1) {
      throw new Error('drawerBank.error.tooSmall: count must be ≥ 1');
    }
    if (openW <= 57) {
      throw new Error(
        `drawerBank.error.tooSmall: cabinet opening width ${openW}mm is ≤ 57mm (minimum for drawer box front/back panels)`,
      );
    }

    // ─── 3. Bank layout ───────────────────────────────────────────────────────
    // drawerBankLayout validates heights count + sum (throws heightCount/heightSum) before any write.
    const slots = drawerBankLayout({ openBottomZ, openH }, N, params.heights);

    // Per-slot minimum-height guard (replaces the old single slotH check).
    for (const slot of slots) {
      const slotH = slot.topZ - slot.bottomZ;
      if (slotH <= 24) {
        throw new Error(
          `drawerBank.error.tooSmall: drawer slot ${slot.index + 1} height ${slotH}mm is ≤ 24mm (minimum for drawer box with clearances)`,
        );
      }
    }

    // Collect existing .zipt basenames for dedupeName
    const existingNames = listZiptBasenames(cab);
    const artifacts: DrawerArtifacts[] = [];
    const timestamp = Date.now();

    // Drawer slides are sold as a pair → one slide hardware part per drawer.
    // Build/write the slide .zipt once (idempotent); each drawer references it (1b.5.3).
    const slideSkuId = DEFAULT_DRAWER_SLIDE_SKU;
    const slideHwPath = `hardware/${slideSkuId}.zipt`;
    const { bytes: slideHwBytes } = await buildSlidePart(slideSkuId);
    await opfs.write(slideHwPath, slideHwBytes);

    for (const slot of slots) {
      const i = slot.index;
      const currentSlotH = slot.topZ - slot.bottomZ;

      // ─── 4a. Front panel ──────────────────────────────────────────────────
      const front = drawerFrontMath(i, N, slot, { openW, frontY }, params.overlay, {
        Tc: dims.Tc,
        reveal: 2,
        insetClearance: 2,
      });

      const frontBaseName = dedupeName(
        `${cab.name} - Drawer Front ${i + 1}`,
        [...existingNames, ...artifacts.map((a) => basenameOf(a.frontPath))],
      );
      const frontPath = `${frontBaseName}.zipt`;

      const frontFeature: PanelFeature = {
        kind: 'panel',
        id: 'panel',
        length: { kind: 'literal', value: front.height },
        width: { kind: 'literal', value: front.width },
        thickness: { kind: 'literal', value: front.thickness },
        thicknessFromMaterial: false,
        materialId: cab.materials[0]?.id ?? 'm',
        grain: 'length',
        edgeBands: { front: null, back: null, left: null, right: null },
      };
      const frontPartDoc: PartDocument = addFeature(newPart(frontBaseName), frontFeature);

      const frontBytes = await packPanel(frontPartDoc);
      if (kernel) await kernel.registerPart(frontPartDoc);
      await opfs.write(frontPath, frontBytes);

      const frontComponent: ComponentInstance = {
        id: `DF${timestamp}-${i}`,
        partPath: frontPath,
        position: {
          x: front.pose.translation.x,
          y: front.pose.translation.y,
          z: front.pose.translation.z,
        },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
        pose: front.pose,
        role: 'drawerFront',
        drawerSpec: { overlay: params.overlay, index: i, count: N },
      };

      // ─── 4b. Drawer box ───────────────────────────────────────────────────
      const boxResult = drawerBoxMath(slot, { openW, innerD });

      const boxBaseName = dedupeName(
        `${cab.name} - Drawer Box ${i + 1}`,
        [
          ...existingNames,
          ...artifacts.map((a) => basenameOf(a.boxPath)),
          basenameOf(frontPath),
        ],
      );
      const boxPath = `${boxBaseName}.ziasm`;
      const boxId = `${boxBaseName}`;

      const { bytes: boxBytes, panelPaths: boxPanelPaths } = await buildDrawerBox(
        boxResult,
        { boxId, name: boxBaseName },
        opfs,
      );

      // Register each box panel part with the kernel
      const boxPanelPartIds: string[] = [];
      for (const panelPath of boxPanelPaths) {
        const project = await unpackProject(await opfs.read(panelPath));
        const panelDoc = (project.manifest as { document: PartDocument }).document;
        if (kernel) await kernel.registerPart(panelDoc);
        boxPanelPartIds.push(panelDoc.id);
      }

      // Write the box .ziasm to OPFS
      await opfs.write(boxPath, boxBytes);

      const boxComponent: ComponentInstance = {
        id: `DB${timestamp}-${i}`,
        partPath: boxPath,
        position: {
          // Box front-bottom-left corner in cabinet-local space:
          // X = left side inner face = Tc + SLIDE_CLEARANCE_PER_SIDE (via boxResult.outer)
          // Actually: box origin = (openW/2 - bw/2 + Tc, 0, slot.bottomZ + BOX_VERT_CLEARANCE)
          // where bw = openW - 2*SLIDE_CLEARANCE_PER_SIDE
          // → x = Tc + SLIDE_CLEARANCE_PER_SIDE
          x: dims.Tc + (openW - boxResult.outer.width) / 2,
          y: 0,
          z: slot.bottomZ + (currentSlotH - boxResult.outer.height) / 2,
        },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
        role: 'drawerBox',
        drawerSpec: { overlay: params.overlay, index: i, count: N },
      };

      // ─── 4c. Slide bores ──────────────────────────────────────────────────
      const slideCtx = {
        drawerIndex: i,
        openBottomZ,
        slotH: currentSlotH,
        bh: boxResult.outer.height,
        cabinet: { H: dims.height, D: dims.depth, Tc: dims.Tc },
        box: { bd: boxResult.outer.depth },
        slideLength: boxResult.outer.depth,
      };
      const { cabinetBores, boxBores } = drawerSlideMath(slideCtx);

      // Write box-side bores into the box panel .zipt files
      await writeBoxSideBores(boxBytes, boxBores, opfs);

      // Append cabinet-side bores to cabinet L/R side panels (snapshot priors once per path)
      await this.appendCabinetSideBores(cab, cabinetBores, opfs);

      // ─── 4d. Slide hardware part (pair) at the drawer-box centroid (1b.5.3) ──
      // Identity pose; bbox w runs front-to-back (world-Y). BOM-bearing marker —
      // the real per-rail slide positions are already captured by the bores above.
      const slideComponent: ComponentInstance = {
        id: `DS${timestamp}-${i}`,
        partPath: slideHwPath,
        position: {
          x: boxComponent.position.x + boxResult.outer.width / 2,
          y: boxComponent.position.y + boxResult.outer.depth / 2,
          z: boxComponent.position.z + boxResult.outer.height / 2,
        },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
        role: 'drawerSlide',
        drawerSpec: { overlay: params.overlay, index: i, count: N },
      };

      artifacts.push({
        frontPath,
        frontPartId: frontPartDoc.id,
        frontComponent,
        boxPath,
        boxPanelPaths,
        boxPanelPartIds,
        boxComponent,
        slideComponent,
      });
    }

    this.artifacts = artifacts;

    // ─── 5. Push components into cabinet doc ─────────────────────────────────
    for (const art of artifacts) {
      cab.components.push(art.frontComponent);
      cab.components.push(art.boxComponent);
      cab.components.push(art.slideComponent);
    }

    // ─── 6. Pack + write + reload ─────────────────────────────────────────────
    await opfs.write(cabinetPath, await packAssembly(cab, new Uint8Array()));
    await this.reloadCabinet(cab);

    // Invalidate the bore-marker cache for the cabinet side panels we appended
    // slide bores to, so the cabinet-side markers refresh live (mirrors revert()).
    // Without this, apply() leaves the side-panel bore cache stale until a tab bump.
    const cabinetSidePaths = [...this.priorCabinetSideBores.keys()];
    if (cabinetSidePaths.length > 0) {
      this.store.getState().boreCacheInvalidator?.(cabinetSidePaths);
    }
  }

  async revert(): Promise<void> {
    const { cabinetPath, opfs, kernel } = this.opts;
    const arts = this.artifacts ?? [];

    const cab = await unpackAssembly(await opfs.read(cabinetPath));

    // Remove drawer components (front + box)
    const createdIds = new Set([
      ...arts.map((a) => a.frontComponent.id),
      ...arts.map((a) => a.boxComponent.id),
      ...arts.map((a) => a.slideComponent.id),
    ]);
    cab.components = cab.components.filter((c) => !createdIds.has(c.id));

    // Delete kernel parts + OPFS blobs for each artifact
    for (const art of arts) {
      // Front .zipt
      if (kernel) await kernel.deletePart(art.frontPartId);
      await opfs.delete?.(art.frontPath);

      // Box panel .zipt files
      for (let j = 0; j < art.boxPanelPaths.length; j++) {
        if (kernel) {
          const partId = art.boxPanelPartIds[j];
          if (partId) await kernel.deletePart(partId);
        }
        await opfs.delete?.(art.boxPanelPaths[j]!);
      }

      // Box .ziasm
      await opfs.delete?.(art.boxPath);

      // Restore box-side panel bores (no-op if already deleted)
      // We attempt best-effort — if the panel file was deleted, skip.
    }

    // Restore cabinet-side bores from snapshot
    const restoredSidePaths: string[] = [];
    for (const [sidePath, prior] of this.priorCabinetSideBores) {
      try {
        const project = await unpackProject(await opfs.read(sidePath));
        const sideDoc = (project.manifest as { document: Record<string, unknown> }).document;
        if (prior.length > 0) {
          sideDoc.bores = prior;
        } else {
          delete sideDoc.bores;
        }
        await opfs.write(
          sidePath,
          await packProject({
            manifest: { ...(project.manifest as object), formatVersion: CURRENT_FORMAT_VERSION, document: sideDoc },
            blobs: {},
          }),
        );
        restoredSidePaths.push(sidePath);
      } catch {
        // best-effort
      }
    }

    await opfs.write(cabinetPath, await packAssembly(cab, new Uint8Array()));
    await this.reloadCabinet(cab);

    if (restoredSidePaths.length > 0) {
      this.store.getState().boreCacheInvalidator?.(restoredSidePaths);
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Append cabinet-side BoreOps to the appropriate L/R side panels in the cabinet.
   * Snapshots priors once per path (idempotent across multiple drawers sharing a side).
   */
  private async appendCabinetSideBores(
    cab: AssemblyDocument,
    bores: BoreOp[],
    opfs: OpfsRWD,
  ): Promise<void> {
    // Route bores to left or right side panel by face role
    const leftBores = bores.filter((b) => b.face.role === LEFT_SIDE_INNER_FACE);
    const rightBores = bores.filter((b) => b.face.role === RIGHT_SIDE_INNER_FACE);

    const leftComp = cab.components.find((c) => c.role === 'leftSide');
    const rightComp = cab.components.find((c) => c.role === 'rightSide');

    for (const { comp, newBores } of [
      { comp: leftComp, newBores: leftBores },
      { comp: rightComp, newBores: rightBores },
    ]) {
      if (!comp || newBores.length === 0) continue;
      const sidePath = comp.partPath;

      const project = await unpackProject(await opfs.read(sidePath));
      const sideDoc = (project.manifest as { document: { bores?: BoreOp[] } }).document;
      const existing = sideDoc.bores ?? [];

      // Snapshot prior bores ONCE per side path (idempotent — mirrors AddDoorCommand pattern)
      if (!this.priorCabinetSideBores.has(sidePath)) {
        this.priorCabinetSideBores.set(sidePath, existing);
      }

      sideDoc.bores = [...existing, ...newBores];
      await opfs.write(
        sidePath,
        await packProject({
          manifest: { ...(project.manifest as object), formatVersion: CURRENT_FORMAT_VERSION, document: sideDoc },
          blobs: {},
        }),
      );
    }
  }

  /** Refresh the cabinet entry in subAssemblyDocs. */
  private async reloadCabinet(cab: AssemblyDocument): Promise<void> {
    const docs = { ...this.store.getState().subAssemblyDocs };
    docs[this.opts.cabinetPath] = cab;
    this.store.getState().setSubAssemblyDocs(docs);
    this.store.getState().setSolverDirty(true);
  }
}

// ─── Module-level helpers ─────────────────────────────────────────────────────

function basenameOf(path: string): string {
  if (path.endsWith('.zipt')) return path.slice(0, -'.zipt'.length);
  if (path.endsWith('.ziasm')) return path.slice(0, -'.ziasm'.length);
  return path;
}

function listZiptBasenames(cab: AssemblyDocument): string[] {
  return cab.components
    .map((c) => c.partPath)
    .filter((p) => p.endsWith('.zipt') || p.endsWith('.ziasm'))
    .map(basenameOf);
}

/**
 * Pack a panel PartDocument into a .zipt.
 * Same pattern as packDoorZipt in AddDoorCommand.
 */
async function packPanel(doc: PartDocument): Promise<Uint8Array> {
  const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  return writeTarGz([{ name: 'manifest.json', data: manifestBytes }]);
}
