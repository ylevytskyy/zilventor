import type { Command } from './Command';
import type { ComponentInstance } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export type PlaceComponentOpts = { partPath: string };

export class PlaceComponentCommand implements Command {
  readonly name = 'PlaceComponent';
  private placedId: string | null = null;
  constructor(private opts: PlaceComponentOpts) {}

  async apply(): Promise<void> {
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
