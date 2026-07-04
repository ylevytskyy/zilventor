import type { Command } from './Command';
import { useAppStore } from '../store/useAppStore';

/**
 * Sets a cut-list row's item number. setCutListItemNumber() has a
 * conflict-bump side effect (a colliding row gets bumped to max+1), so
 * revert() must restore the whole prior map, not just this rowKey, or the
 * bumped partner would stay put. apply() semantics are unchanged from before
 * (still calls setCutListItemNumber the same way) — only revert()/name added.
 */
export class SetCutListItemNumberCommand implements Command {
  readonly name = 'SetCutListItemNumber';
  private priorMap: Record<string, number> = {};

  constructor(private opts: { rowKey: string; n: number }) {}

  async apply(): Promise<void> {
    this.priorMap = { ...(useAppStore.getState().activeAssembly?.cutListItemNumbers ?? {}) };
    useAppStore.getState().setCutListItemNumber(this.opts.rowKey, this.opts.n);
  }

  async revert(): Promise<void> {
    useAppStore.getState().setCutListItemNumbers(this.priorMap);
  }
}
