// packages/app/src/commands/SetActiveSheetCommand.ts
import type { Command } from './Command';
import { useAppStore } from '../store/useAppStore';
import { drawingDocState } from '../store/drawingDocState';

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
    const nextDoc = { ...d, activeSheetId: this.sheetId };
    useAppStore.setState(drawingDocState(nextDoc));
  }

  async revert(): Promise<void> {
    if (this.prevSheetId === null) return;
    const d = useAppStore.getState().activeDrawing;
    if (!d) return;
    const prev = this.prevSheetId;
    const nextDoc = { ...d, activeSheetId: prev };
    useAppStore.setState(drawingDocState(nextDoc));
  }
}
