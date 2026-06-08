/**
 * CreateComponentPatternCommand — bakes a rectangular 1D/2D component grid.
 *
 * Structure cloned from PlaceComponentCommand.ts (apply/revert + addComponent/
 * removeComponent pattern, lines 39–91), simplified to pattern-specific logic.
 *
 * Translation field: new instances carry their translation in `pose.translation`
 * (the field the renderer/constraint solver reads; `position` is set to the same
 * value for legacy compatibility). Source pose is read from `src.pose` if present,
 * falling back to `src.position` for instances that predate the pose field.
 */
import type { Command } from './Command';
import type { ComponentInstance, PatternAxis } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { computeRectGridPoses } from '../assembly/poseHelpers';

export type CreateComponentPatternOpts = {
  sourceInstanceId: string;
  dir1: PatternAxis;
  count1: number;
  spacing1: number;
  dir2?: PatternAxis;
  count2?: number;
  spacing2?: number;
};

export class CreateComponentPatternCommand implements Command {
  readonly name = 'CreateComponentPattern';
  private createdIds: string[] = [];

  constructor(private opts: CreateComponentPatternOpts) {}

  async apply(): Promise<void> {
    const asm = useAppStore.getState().activeAssembly;
    if (!asm) return;
    const src = asm.components.find((c) => c.id === this.opts.sourceInstanceId);
    if (!src) return;

    // Prefer src.pose (solver/renderer canonical field); fall back to legacy position.
    const srcPose = src.pose ?? {
      translation: { x: src.position.x, y: src.position.y, z: src.position.z },
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
    };

    const poses = computeRectGridPoses(
      srcPose,
      this.opts.dir1, this.opts.count1, this.opts.spacing1,
      this.opts.dir2, this.opts.count2, this.opts.spacing2,
    );

    this.createdIds = [];
    poses.forEach((pose, idx) => {
      const id = `Cp${Date.now()}_${idx}`;
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
