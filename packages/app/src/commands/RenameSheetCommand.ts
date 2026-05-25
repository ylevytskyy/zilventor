import type { Command } from './Command';
import type { DrawingDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { drawingDocState } from '../store/drawingDocState';

export class RenameSheetCommand implements Command {
  readonly name = 'RenameSheet';
  private prevName: string | null = null;

  constructor(private readonly opts: { sheetId: string; name: string }) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheet = doc.document.sheets.find(s => s.id === this.opts.sheetId);
    if (!sheet) return;

    this.prevName = sheet.name;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId ? { ...s, name: this.opts.name } : s
      ),
    };
    useAppStore.setState(drawingDocState(next));
  }

  async revert(): Promise<void> {
    if (this.prevName === null) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId ? { ...s, name: this.prevName! } : s
      ),
    };
    useAppStore.setState(drawingDocState(next));
    this.prevName = null;
  }
}
