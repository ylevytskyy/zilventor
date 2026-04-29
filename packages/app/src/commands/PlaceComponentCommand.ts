import type { Command } from './Command';
import type { ComponentInstance } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { wouldCreateCycle } from '../assembly/cycleCheck';
import type { OpfsLike } from '../assembly/SubAssemblyCache';

export type PlaceComponentOpts = { partPath: string; opfs?: OpfsLike };

export class PlaceComponentCommand implements Command {
  readonly name = 'PlaceComponent';
  private placedId: string | null = null;
  constructor(private opts: PlaceComponentOpts) {}

  async apply(): Promise<void> {
    if (this.opts.partPath.endsWith('.ziasm') && this.opts.opfs) {
      const active = useAppStore.getState().activeAssembly;
      if (!active) return;
      const activeDocPath = `${active.name}.ziasm`;
      const cyclic = await wouldCreateCycle(activeDocPath, this.opts.partPath, this.opts.opfs);
      if (cyclic) {
        useAppStore.getState().setStatus(
          `Cannot place ${this.opts.partPath}: would create a sub-assembly cycle.`,
        );
        return;
      }
    }
    const id = `C${Date.now()}`;
    const instance: ComponentInstance = {
      id,
      partPath: this.opts.partPath,
      position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
    };
    useAppStore.getState().addComponent(instance);
    this.placedId = id;
  }

  async revert(): Promise<void> {
    if (this.placedId) {
      useAppStore.getState().removeComponent(this.placedId);
      this.placedId = null;
    }
  }
}
