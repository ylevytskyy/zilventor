import { useAppStore } from '../store/useAppStore';
import type { ComponentColor } from '@zilventor/shared';

export type SetComponentColorOpts = { id: string; color: ComponentColor | undefined };

export class SetComponentColorCommand {
  constructor(private opts: SetComponentColorOpts) {}
  async apply(): Promise<void> {
    useAppStore.getState().setComponentColor(this.opts.id, this.opts.color);
  }
}
