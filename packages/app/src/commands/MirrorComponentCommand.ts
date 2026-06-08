import type { Command } from './Command';
import type { ComponentInstance, MirrorPlane } from '@zilventor/shared';
import type { KernelApi } from '@zilventor/kernel/src/api';
import { useAppStore } from '../store/useAppStore';
import { computeMirroredPose } from '../assembly/poseHelpers';
import { dedupeName } from '../import/dedupeName';

export type MirrorComponentOpts = {
  sourceInstanceId: string;
  /** Kernel-registered part ID for the source (UUID from PartDocument.id).
   *  Must NOT be the component/instance id — kernel.mirrorPart operates on part UUIDs. */
  sourcePartKernelId: string;
  plane: MirrorPlane;
  kernel: Pick<KernelApi, 'mirrorPart' | 'deletePart' | 'saveToBytes'>;
  opfs: {
    write(path: string, data: Uint8Array): Promise<void>;
    delete(path: string): Promise<void>;
    listAll(): Promise<string[]>;
  };
};

export class MirrorComponentCommand implements Command {
  readonly name = 'MirrorComponent';
  private placedId: string | null = null;
  private mirrorPartId: string | null = null;
  private mirrorPartPath: string | null = null;

  constructor(private opts: MirrorComponentOpts) {}

  async apply(): Promise<void> {
    const asm = useAppStore.getState().activeAssembly;
    if (!asm) return;
    const src = asm.components.find((c) => c.id === this.opts.sourceInstanceId);
    if (!src) return;

    const { kernel, opfs, plane } = this.opts;

    // 1. Mirror the BREP in the kernel (plane='yz' → S=diag(-1,1,1))
    //    opts.sourcePartKernelId is the kernel PartDocument.id UUID — NOT the instance id
    const { partId: mirrorPartId } = await kernel.mirrorPart(this.opts.sourcePartKernelId);
    this.mirrorPartId = mirrorPartId;

    // 2. Name the mirrored part (dedup against existing OPFS files)
    const srcName = src.partPath.replace(/\.zipt$/, '');
    const existingNames = (await opfs.listAll())
      .filter((p) => p.endsWith('.zipt'))
      .map((p) => p.replace(/\.zipt$/, ''));
    const mirrorName = dedupeName(`${srcName}_mirror`, existingNames);
    this.mirrorPartPath = `${mirrorName}.zipt`;

    // 3. Save mirrored part bytes to OPFS
    const archiveBytes = await kernel.saveToBytes(mirrorPartId);
    await opfs.write(this.mirrorPartPath, archiveBytes);

    // 4. Compute mirrored pose (R' = M * R * S, t' = M * t)
    const srcPose = src.pose ?? {
      translation: { x: src.position.x, y: src.position.y, z: src.position.z },
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
    };
    const mirroredPose = computeMirroredPose(srcPose, plane);

    // 5. Add the mirrored component instance to the assembly
    const id = `Cm${crypto.randomUUID()}`;
    const instance: ComponentInstance = {
      id,
      partPath: this.mirrorPartPath,
      position: { x: mirroredPose.translation.x, y: mirroredPose.translation.y, z: mirroredPose.translation.z },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
      pose: mirroredPose,
    };
    useAppStore.getState().addComponent(instance);
    this.placedId = id;
  }

  async revert(): Promise<void> {
    if (this.placedId) {
      useAppStore.getState().removeComponent(this.placedId);
      this.placedId = null;
    }
    if (this.mirrorPartId) {
      try { await this.opts.kernel.deletePart(this.mirrorPartId); } catch { /* best-effort */ }
      this.mirrorPartId = null;
    }
    if (this.mirrorPartPath) {
      try { await this.opts.opfs.delete(this.mirrorPartPath); } catch { /* best-effort */ }
      this.mirrorPartPath = null;
    }
  }
}
