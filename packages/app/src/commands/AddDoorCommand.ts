import type { Command } from './Command';
import type {
  AssemblyDocument,
  BoreOp,
  ComponentInstance,
  DoorMathInput,
  PanelFeature,
  PartDocument,
} from '@zilventor/shared';
import {
  CURRENT_FORMAT_VERSION,
  doorMath,
  hingeCupBores,
  hingePositions,
  hingePlateBores,
  DEFAULT_SHELF_PIN_PARAMS,
} from '@zilventor/shared';
// ADDENDUM §1: import face-sign constants from the shared conventions module (Phase 0 output).
// DO NOT re-declare local literals — a single Phase-0 change propagates to all consumers.
import {
  DOOR_CUP_FACE,
  LEFT_SIDE_INNER_FACE,
  RIGHT_SIDE_INNER_FACE,
} from '@zilventor/shared';
import { newPart, addFeature } from '@zilventor/kernel/src/adapter/PartDocument';
import { writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import { packAssembly, unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { dedupeName } from '../import/dedupeName';
import { useAppStore } from '../store/useAppStore';
import { deriveCabinetDims } from './cabinetDims';

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

/** A door created during apply() — recorded so revert (and redo) can replay/undo it. */
interface CreatedDoor {
  partPath: string;     // OPFS .zipt path of the door part
  partId: string;       // PartDocument id (for kernel deletePart)
  componentId: string;  // ComponentInstance.id pushed into the cabinet doc
  bytes: Uint8Array;    // packed .zipt bytes (for redo without rebuild)
  component: ComponentInstance; // the pushed component (for redo re-push)
}

export class AddDoorCommand implements Command {
  readonly name = 'AddDoor';
  private readonly store: typeof useAppStore;
  /** Door artifacts created during the FIRST apply() — replayed on redo. */
  private createdDoors: CreatedDoor[] | null = null;
  /** sidePanelPath → prior bores[] before this command appended plates (for revert). */
  private priorSideBores = new Map<string, BoreOp[]>();

  constructor(private readonly opts: {
    cabinetPath: string;
    params: DoorMathInput;
    opfs: OpfsRWD;
    kernel?: KernelPartApi;
    store?: typeof useAppStore;
  }) {
    this.store = opts.store ?? useAppStore;
  }

  async apply(): Promise<void> {
    const cab = await unpackAssembly(await this.opts.opfs.read(this.opts.cabinetPath));

    // ADDENDUM §4: derive real cabinet dims from the unpacked .ziasm; override params.cabinet.
    const derivedDims = await deriveCabinetDims(cab, this.opts.opfs);
    const resolvedParams: DoorMathInput = {
      ...this.opts.params,
      cabinet: derivedDims,
    };

    // Build a fresh set of doors only on the FIRST apply; redo replays captured artifacts.
    const doors: CreatedDoor[] = this.createdDoors ?? [];
    const isRedo = this.createdDoors !== null;

    if (!isRedo) {
      const panels = doorMath(resolvedParams);
      const existingNames = this.listZiptBasenames(cab);
      let index = 0;
      for (const panel of panels) {
        const doorH = panel.dims.length;
        const doorW = panel.dims.width;
        const Td = panel.dims.thickness;

        // Door part name — de-dup against existing .zipt basenames.
        const baseName = panels.length === 1
          ? `${cab.name} - Door`
          : `${cab.name} - Door ${index + 1}`;
        const finalName = dedupeName(baseName, [...existingNames, ...doors.map((d) => basenameOf(d.partPath))]);
        const doorPath = `${finalName}.zipt`;

        // Door PanelFeature (length=doorH, width=doorW, thickness=Td literals).
        const panelFeature: PanelFeature = {
          kind: 'panel',
          id: 'panel',
          length: { kind: 'literal', value: doorH },
          width: { kind: 'literal', value: doorW },
          thickness: { kind: 'literal', value: Td },
          thicknessFromMaterial: false,
          materialId: cab.materials[0]?.id ?? 'm',
          grain: 'length',
          edgeBands: { front: null, back: null, left: null, right: null },
        };

        // Cup bores on the carcass-facing broad face.
        // DOOR_CUP_FACE is imported from prisadkaFaceConventions.ts (Phase 0 output, §1).
        const uPositions = hingePositions(doorH, panel.doorSpec.hingeCount);
        const cupBores: BoreOp[] = hingeCupBores(
          panel.dims,
          DOOR_CUP_FACE,
          panel.doorSpec.hingeSide,
          resolvedParams.overlay,
          uPositions,
        );

        // ADDENDUM §5: packDoorZipt is async (writeTarGz returns Promise<Uint8Array>).
        const part: PartDocument = addFeature(newPart(finalName), panelFeature);
        const doorDoc: PartDocument = { ...part, bores: cupBores };
        const bytes = await packDoorZipt(doorDoc);
        if (this.opts.kernel) await this.opts.kernel.registerPart(doorDoc);
        await this.opts.opfs.write(doorPath, bytes);

        const component: ComponentInstance = {
          id: `D${Date.now()}-${index}`,
          partPath: doorPath,
          position: { x: panel.pose.translation.x, y: panel.pose.translation.y, z: panel.pose.translation.z },
          rotation: { rx: 0, ry: 0, rz: 0 },
          visible: true,
          pose: panel.pose,
          role: 'door',
          doorSpec: panel.doorSpec,
        };
        doors.push({ partPath: doorPath, partId: doorDoc.id, componentId: component.id, bytes, component });
        index++;
      }
      this.createdDoors = doors;
    } else {
      // REDO: re-register parts + re-write the captured .zipt bytes (skip doorMath/rebuild).
      for (const d of doors) {
        if (this.opts.kernel) {
          const re = await unpackProjectDoc(d);
          await this.opts.kernel.registerPart(re);
        }
        await this.opts.opfs.write(d.partPath, d.bytes);
      }
    }

    // Push all door components into the cabinet doc (avoid dupes on redo).
    for (const d of doors) {
      if (!cab.components.some((c) => c.id === d.componentId)) {
        cab.components.push(d.component);
      }
    }

    // Plate bores into side panels.
    const affectedSidePaths = await this.writePlateBores(cab, doors, resolvedParams);

    await this.opts.opfs.write(this.opts.cabinetPath, await packAssembly(cab, new Uint8Array()));
    await this.reloadCabinet(cab);

    if (affectedSidePaths.size > 0) {
      this.store.getState().boreCacheInvalidator?.([...affectedSidePaths]);
    }
  }

  async revert(): Promise<void> {
    const doors = this.createdDoors ?? [];
    const cab = await unpackAssembly(await this.opts.opfs.read(this.opts.cabinetPath));

    // Remove door components.
    const doorIds = new Set(doors.map((d) => d.componentId));
    cab.components = cab.components.filter((c) => !doorIds.has(c.id));

    // Delete door parts (kernel + OPFS).
    for (const d of doors) {
      if (this.opts.kernel) await this.opts.kernel.deletePart(d.partId);
      if (typeof this.opts.opfs.delete === 'function') {
        try { await this.opts.opfs.delete(d.partPath); } catch { /* best-effort */ }
      }
    }

    // Restore each affected side panel's bores[] to its pre-apply snapshot.
    const restoredSidePaths: string[] = [];
    for (const [sidePath, prior] of this.priorSideBores) {
      const project = await unpackProject(await this.opts.opfs.read(sidePath));
      const sideDoc = (project.manifest as { document: Record<string, unknown> }).document;
      if (prior.length > 0) {
        sideDoc.bores = prior;
      } else {
        delete sideDoc.bores;
      }
      await this.opts.opfs.write(
        sidePath,
        await packProject({
          manifest: { ...(project.manifest as object), formatVersion: CURRENT_FORMAT_VERSION, document: sideDoc },
          blobs: {},
        }),
      );
      restoredSidePaths.push(sidePath);
    }

    await this.opts.opfs.write(this.opts.cabinetPath, await packAssembly(cab, new Uint8Array()));
    await this.reloadCabinet(cab);

    if (restoredSidePaths.length > 0) {
      this.store.getState().boreCacheInvalidator?.(restoredSidePaths);
    }
    // Note: do NOT clear priorSideBores/createdDoors — they are the redo-replay artifacts.
  }

  /** Refresh the cabinet entry in subAssemblyDocs (additive loader won't replace it). */
  private async reloadCabinet(cab: AssemblyDocument): Promise<void> {
    const docs = { ...this.store.getState().subAssemblyDocs };
    docs[this.opts.cabinetPath] = cab;
    this.store.getState().setSubAssemblyDocs(docs);
    this.store.getState().setSolverDirty(true);
  }

  /**
   * Write Ø5 hinge-plate bores onto the hinge-side panel(s).
   * Returns the set of side-panel OPFS paths written (for boreCacheInvalidator).
   */
  private async writePlateBores(
    cab: AssemblyDocument,
    doors: CreatedDoor[],
    resolvedParams: DoorMathInput,
  ): Promise<Set<string>> {
    const affectedSidePaths = new Set<string>();

    for (const d of doors) {
      const spec = d.component.doorSpec!;
      const side = await this.resolveSidePanel(cab, spec.hingeSide);
      if (!side) continue;

      // uPositions come from the door part's PanelFeature length (= doorH).
      const doorProject = await unpackProject(await this.opts.opfs.read(d.partPath));
      const doorDoc = (doorProject.manifest as { document: { featureTree?: Array<Record<string, unknown>> } }).document;
      const dp = (doorDoc.featureTree ?? []).find((f) => f.kind === 'panel') as { length: { value: number } } | undefined;
      const dH = dp?.length.value ?? 0;
      const uPositions = hingePositions(dH, spec.hingeCount);

      const plates: BoreOp[] = hingePlateBores(
        side.dims,
        sideInnerFace(spec.hingeSide),
        uPositions,
        DEFAULT_SHELF_PIN_PARAMS.frontSetback, // plate column coincides with система-32 front column
      );

      // Snapshot prior bores once per side path (idempotent across doors sharing a side).
      const project = await unpackProject(await this.opts.opfs.read(side.path));
      const sideDoc = (project.manifest as { document: { bores?: BoreOp[] } }).document;
      const existing = sideDoc.bores ?? [];
      if (!this.priorSideBores.has(side.path)) {
        this.priorSideBores.set(side.path, existing);
      }
      sideDoc.bores = [...existing, ...plates];
      await this.opts.opfs.write(
        side.path,
        await packProject({
          manifest: { ...(project.manifest as object), formatVersion: CURRENT_FORMAT_VERSION, document: sideDoc },
          blobs: {},
        }),
      );
      affectedSidePaths.add(side.path);
    }

    return affectedSidePaths;
  }

  /** The .zipt path + native dims of the side panel matching a hinge side. */
  private async resolveSidePanel(
    cab: AssemblyDocument,
    hingeSide: 'left' | 'right',
  ): Promise<{ path: string; dims: { length: number; width: number; thickness: number } } | null> {
    const role = hingeSide === 'left' ? 'leftSide' : 'rightSide';
    const comp = cab.components.find((c) => c.role === role);
    if (!comp) return null;
    const project = await unpackProject(await this.opts.opfs.read(comp.partPath));
    const doc = (project.manifest as { document: { featureTree?: Array<Record<string, unknown>> } }).document;
    const panel = (doc.featureTree ?? []).find((f) => f.kind === 'panel') as
      | { length: { value: number }; width: { value: number }; thickness: { value: number } }
      | undefined;
    if (!panel) return null;
    return {
      path: comp.partPath,
      dims: { length: panel.length.value, width: panel.width.value, thickness: panel.thickness.value },
    };
  }

  /** Basenames (no `.zipt`) of all .zipt component paths in the cabinet doc, for de-dup. */
  private listZiptBasenames(cab: AssemblyDocument): string[] {
    return cab.components
      .map((c) => c.partPath)
      .filter((p) => p.endsWith('.zipt'))
      .map(basenameOf);
  }
}

function basenameOf(path: string): string {
  return path.endsWith('.zipt') ? path.slice(0, -'.zipt'.length) : path;
}

/**
 * Pack a door PartDocument into a .zipt (manifest-only — PanelFeature regenerates geometry).
 * ADDENDUM §5: async because writeTarGz (tarGzipUtil.ts:91) returns Promise<Uint8Array>.
 * Mirrors CreateCabinetCommand.packPanelPart (which is also async and awaits writeTarGz).
 */
async function packDoorZipt(doc: PartDocument): Promise<Uint8Array> {
  const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  return writeTarGz([{ name: 'manifest.json', data: manifestBytes }]);
}

/** Re-read a door PartDocument from its captured bytes (redo re-register). */
async function unpackProjectDoc(d: CreatedDoor): Promise<PartDocument> {
  const entries = await import('@zilventor/kernel/src/storage/tarGzipUtil').then((m) =>
    m.readTarGz(d.bytes),
  );
  const m = entries.find((e) => e.name === 'manifest.json')!;
  return JSON.parse(new TextDecoder().decode(m.data)).document as PartDocument;
}

/**
 * Side inner broad face — derived from prisadkaFaceConventions (Phase 0 output, §H.1).
 * LEFT_SIDE_INNER_FACE and RIGHT_SIDE_INNER_FACE are imported, never re-declared.
 */
function sideInnerFace(hingeSide: 'left' | 'right'): 'Top' | 'Bottom' {
  return hingeSide === 'left' ? LEFT_SIDE_INNER_FACE : RIGHT_SIDE_INNER_FACE;
}
