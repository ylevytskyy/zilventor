/**
 * AddFaceFrameCommand — Frame Generator slice 1.
 *
 * apply():
 *   1. Unpack cabinet .ziasm + deriveCabinetDims.
 *   2. layoutFaceFrame() — throws on degenerate input BEFORE any write (atomic).
 *   3. Per member: build a panel PartDocument, register, write .zipt, push ComponentInstance.
 *   4. packAssembly + write cabinet + reloadCabinet.
 *
 * revert():
 *   Remove created components, delete OPFS .zipt blobs, deletePart from kernel, repack + reload.
 *
 * Architecture: mirrors AddDrawerBankCommand (apply-atomic, revert-clean).
 * packPanel and reloadCabinet copied verbatim from AddDrawerBankCommand.ts.
 */

import type { Command } from './Command';
import type {
  AssemblyDocument,
  ComponentInstance,
  PanelFeature,
  PartDocument,
} from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION, layoutFaceFrame } from '@zilventor/shared';
import { newPart, addFeature } from '@zilventor/kernel/src/adapter/PartDocument';
import { packAssembly, unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
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

export interface AddFaceFrameParams {
  rows: number;
  cols: number;
  stileWidth: number;
  railWidth: number;
  thickness: number;
}

/** Artifact created per frame member during apply(). */
interface MemberArtifact {
  partId: string;
  partPath: string;
  componentId: string;
}

/**
 * Pack a panel PartDocument into a .zipt.
 * Copied verbatim from AddDrawerBankCommand.ts:431-435.
 */
async function packPanel(doc: PartDocument): Promise<Uint8Array> {
  const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  return writeTarGz([{ name: 'manifest.json', data: manifestBytes }]);
}

export class AddFaceFrameCommand implements Command {
  readonly name = 'AddFaceFrame';
  private readonly store: typeof useAppStore;

  /** Artifacts created on apply() — cleared on revert(). */
  private artifacts: MemberArtifact[] | null = null;

  constructor(private readonly opts: {
    cabinetPath: string;
    params: AddFaceFrameParams;
    opfs: OpfsRWD;
    kernel?: KernelPartApi;
    store?: typeof useAppStore;
  }) {
    this.store = opts.store ?? useAppStore;
  }

  async apply(): Promise<void> {
    const { cabinetPath, params, opfs, kernel } = this.opts;

    // 1. Unpack cabinet + derive dims.
    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    const dims = await deriveCabinetDims(cab, opfs);

    // 2. layoutFaceFrame throws on degenerate input BEFORE any write (atomic guard).
    const members = layoutFaceFrame({
      width: dims.width,
      height: dims.height,
      toekickHeight: dims.toekickHeight,
      depth: dims.depth,
      rows: params.rows,
      cols: params.cols,
      stileWidth: params.stileWidth,
      railWidth: params.railWidth,
      thickness: params.thickness,
    });

    // 3. Per member: build panel PartDocument, write .zipt, push ComponentInstance.
    const baseDir = cabinetPath.replace(/\.ziasm$/, '');
    const stamp = Date.now();
    const artifacts: MemberArtifact[] = [];
    const newComponents: ComponentInstance[] = [];

    for (let idx = 0; idx < members.length; idx++) {
      const m = members[idx]!;
      const partPath = `${baseDir}-ff${stamp}-${idx}.zipt`;

      const panelFeature: PanelFeature = {
        kind: 'panel',
        id: 'panel',
        length: { kind: 'literal', value: m.dims.length },
        width: { kind: 'literal', value: m.dims.width },
        thickness: { kind: 'literal', value: m.dims.thickness },
        thicknessFromMaterial: false,
        materialId: cab.materials[0]?.id ?? 'm',
        grain: m.role === 'faceFrameStile' ? 'length' : 'width',
        edgeBands: { front: null, back: null, left: null, right: null },
      };
      const partDoc = addFeature(newPart(`FaceFrame ${m.role} ${idx}`), panelFeature);

      if (kernel) await kernel.registerPart(partDoc);
      await opfs.write(partPath, await packPanel(partDoc));

      const componentId = `FF${stamp}-${idx}`;
      newComponents.push({
        id: componentId,
        partPath,
        position: {
          x: m.pose.translation.x,
          y: m.pose.translation.y,
          z: m.pose.translation.z,
        },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
        pose: m.pose,
        role: m.role,
      });
      artifacts.push({ partId: partDoc.id, partPath, componentId });
    }

    // 4. Push components, pack + write + reload.
    for (const c of newComponents) cab.components.push(c);
    await opfs.write(cabinetPath, await packAssembly(cab, new Uint8Array()));
    this.artifacts = artifacts;
    await this.reloadCabinet(cab);
  }

  async revert(): Promise<void> {
    if (!this.artifacts) return;
    const { cabinetPath, opfs, kernel } = this.opts;

    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    const ids = new Set(this.artifacts.map((a) => a.componentId));
    cab.components = cab.components.filter((c) => !ids.has(c.id));

    for (const a of this.artifacts) {
      if (kernel) await kernel.deletePart(a.partId);
      await opfs.delete?.(a.partPath);
    }

    await opfs.write(cabinetPath, await packAssembly(cab, new Uint8Array()));
    this.artifacts = null;
    await this.reloadCabinet(cab);
  }

  /** Refresh the cabinet entry in subAssemblyDocs. Copied verbatim from AddDrawerBankCommand.ts:404-409. */
  private async reloadCabinet(cab: AssemblyDocument): Promise<void> {
    const docs = { ...this.store.getState().subAssemblyDocs };
    docs[this.opts.cabinetPath] = cab;
    this.store.getState().setSubAssemblyDocs(docs);
    this.store.getState().setSolverDirty(true);
  }
}
