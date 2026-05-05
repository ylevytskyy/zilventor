import type { Command } from './Command';
import type { SheetSize, DrawingDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

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
    // TODO(phase-7): drop cast after activeDocument union widening
    const doc = state.activeDocument as unknown as { kind: string; document: DrawingDocument } | null;
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
    // TODO(phase-7): drop cast after activeDocument union widening
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
  }

  async revert(): Promise<void> {
    if (!this.prevSize || !this.prevOrientation) return;
    const state = useAppStore.getState();
    // TODO(phase-7): drop cast after activeDocument union widening
    const doc = state.activeDocument as unknown as { kind: string; document: DrawingDocument } | null;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, size: this.prevSize!, orientation: this.prevOrientation! }
          : s
      ),
    };
    // TODO(phase-7): drop cast after activeDocument union widening
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
    this.prevSize = null;
    this.prevOrientation = null;
  }
}
