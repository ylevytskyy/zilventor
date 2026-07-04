import type { Command } from './Command';
import { useAppStore } from '../store/useAppStore';

/**
 * Sets a BOM row's item number. setBomItemNumber() has a conflict-bump side
 * effect (a colliding row gets bumped to max+1), so revert() must restore the
 * whole prior map, not just this rowKey, or the bumped partner would stay put.
 */
export class SetBomItemNumberCommand implements Command {
  readonly name = 'SetBomItemNumber';
  private priorMap: Record<string, number> = {};

  constructor(private opts: { rowKey: string; n: number }) {}

  async apply(): Promise<void> {
    this.priorMap = { ...(useAppStore.getState().activeAssembly?.bomItemNumbers ?? {}) };
    useAppStore.getState().setBomItemNumber(this.opts.rowKey, this.opts.n);
  }

  async revert(): Promise<void> {
    useAppStore.getState().setBomItemNumbers(this.priorMap);
  }
}
