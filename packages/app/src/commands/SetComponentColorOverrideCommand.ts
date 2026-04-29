import type { Command } from './Command';
import type { ComponentColor, ComponentPath } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class SetComponentColorOverrideCommand implements Command {
  readonly name = 'SetComponentColorOverride';
  private prev: ComponentColor | null = null;
  private hadPrev = false;
  constructor(private readonly args: { path: ComponentPath; color: ComponentColor | null }) {}

  async apply(): Promise<void> {
    const s = useAppStore.getState();
    if (s.activeDocument?.kind !== 'assembly') return;
    const k = pathKey(this.args.path);
    const existing = s.activeDocument.document.colorOverrides[k];
    this.hadPrev = existing !== undefined;
    this.prev = existing ?? null;
    s.setColorOverride(this.args.path, this.args.color);
  }

  async revert(): Promise<void> {
    useAppStore.getState().setColorOverride(this.args.path, this.hadPrev ? this.prev : null);
  }
}
