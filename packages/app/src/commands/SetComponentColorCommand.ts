import type { Command } from './Command';
import { useAppStore } from '../store/useAppStore';
import type { ComponentColor } from '@zilventor/shared';

export type SetComponentColorOpts = { componentIds: string[]; color: ComponentColor | undefined };

type ColorSnapshot = { id: string; hadColor: boolean; priorColor: ComponentColor | undefined };

/**
 * Sets a component's color for one or more components in a single undo entry.
 * exactOptionalPropertyTypes: ComponentInstance.color is optional — revert()
 * restores absence (key deleted) if the component had no color before apply(),
 * or the prior color otherwise.
 */
export class SetComponentColorCommand implements Command {
  readonly name = 'SetComponentColor';
  private snapshots: ColorSnapshot[] = [];

  constructor(private opts: SetComponentColorOpts) {}

  async apply(): Promise<void> {
    const components = useAppStore.getState().activeAssembly?.components ?? [];
    this.snapshots = this.opts.componentIds.map((id) => {
      const c = components.find((x) => x.id === id);
      return { id, hadColor: c ? 'color' in c : false, priorColor: c?.color };
    });
    for (const id of this.opts.componentIds) {
      useAppStore.getState().setComponentColor(id, this.opts.color);
    }
  }

  async revert(): Promise<void> {
    for (const snap of this.snapshots) {
      useAppStore.getState().setComponentColor(snap.id, snap.hadColor ? snap.priorColor : undefined);
    }
  }
}
