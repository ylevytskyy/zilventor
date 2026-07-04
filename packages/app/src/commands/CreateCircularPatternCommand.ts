/**
 * CreateCircularPatternCommand — bakes a circular/arc component pattern.
 *
 * Structure mirrors CreateComponentPatternCommand.ts (apply/revert +
 * addComponent/removeComponent pattern). Delegates pose math entirely to
 * computeCircularPoses (poseHelpers.ts), which returns count-1 new poses
 * (source excluded).
 */
import type { Command } from './Command';
import type { ComponentInstance, PatternAxis, Vec3 } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { computeCircularPoses } from '../assembly/poseHelpers';
import { componentLocalPose } from '../assembly/walkers/componentLocalPose';

export type CreateCircularPatternOpts = {
  sourceInstanceId: string;
  axis: PatternAxis;
  center: Vec3;
  count: number;
  totalAngleDeg: number;
  rotateInstances: boolean;
};

export class CreateCircularPatternCommand implements Command {
  readonly name = 'CreateCircularPattern';
  private createdIds: string[] = [];

  constructor(private opts: CreateCircularPatternOpts) {}

  async apply(): Promise<void> {
    const asm = useAppStore.getState().activeAssembly;
    if (!asm) return;
    const src = asm.components.find((c) => c.id === this.opts.sourceInstanceId);
    if (!src) return;

    // Prefer src.pose (solver/renderer canonical field); fall back to legacy position.
    const srcPose = componentLocalPose(src);

    const poses = computeCircularPoses(
      srcPose,
      this.opts.axis,
      this.opts.center,
      this.opts.count,
      this.opts.totalAngleDeg,
      this.opts.rotateInstances,
    );

    this.createdIds = [];
    poses.forEach((pose) => {
      const id = `Cp${crypto.randomUUID()}`;
      const instance: ComponentInstance = {
        id,
        partPath: src.partPath,
        // position mirrors pose.translation for legacy field compatibility
        position: { x: pose.translation.x, y: pose.translation.y, z: pose.translation.z },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
        pose,
        ...(src.color ? { color: src.color } : {}),
      };
      useAppStore.getState().addComponent(instance);
      this.createdIds.push(id);
    });
  }

  async revert(): Promise<void> {
    for (const id of this.createdIds) {
      useAppStore.getState().removeComponent(id);
    }
    this.createdIds = [];
  }
}
