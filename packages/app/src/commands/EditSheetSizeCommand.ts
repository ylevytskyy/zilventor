import type { Command } from './Command';
import type { SheetSize, DrawingDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { drawingDocState } from '../store/drawingDocState';

export class EditSheetSizeCommand implements Command {
  readonly name = 'EditSheetSize';
  private prevSize: SheetSize | null = null;
  private prevOrientation: 'landscape' | 'portrait' | null = null;

  constructor(
    private readonly opts: {
      sheetId: string;
      size: SheetSize;
      orientation: 'landscape' | 'portrait';
    }
  ) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheet = doc.document.sheets.find(s => s.id === this.opts.sheetId);
    if (!sheet) return;

    this.prevSize = sheet.size;
    this.prevOrientation = sheet.orientation;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, size: this.opts.size, orientation: this.opts.orientation }
          : s
      ),
    };
    useAppStore.setState(drawingDocState(next));
  }

  async revert(): Promise<void> {
    if (!this.prevSize || !this.prevOrientation) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, size: this.prevSize!, orientation: this.prevOrientation! }
          : s
      ),
    };
    useAppStore.setState(drawingDocState(next));
    this.prevSize = null;
    this.prevOrientation = null;
  }
}
