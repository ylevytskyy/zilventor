// packages/app/src/commands/SetActiveSheetCommand.ts
import type { Command } from './Command';
import { useAppStore } from '../store/useAppStore';

export class SetActiveSheetCommand implements Command {
  readonly name = 'SetActiveSheet';
  readonly sheetId: string;
  private prevSheetId: string | null = null;

  constructor(opts: { sheetId: string }) {
    this.sheetId = opts.sheetId;
  }

  async apply(): Promise<void> {
    const d = useAppStore.getState().activeDrawing;
    if (!d) return;
    this.prevSheetId = d.activeSheetId;
    useAppStore.setState({
      activeDrawing: { ...d, activeSheetId: this.sheetId },
    });
  }

  async revert(): Promise<void> {
    if (this.prevSheetId === null) return;
    const d = useAppStore.getState().activeDrawing;
    if (!d) return;
    const prev = this.prevSheetId;
    useAppStore.setState({ activeDrawing: { ...d, activeSheetId: prev } });
  }
}
