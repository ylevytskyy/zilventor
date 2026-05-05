import type { Command } from './Command';
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class DeleteSheetCommand implements Command {
  readonly name = 'DeleteSheet';
  private prevSheet: DrawingSheet | null = null;
  private prevSheetIndex: number = -1;
  private prevActiveSheetId: string | null = null;

  constructor(private readonly opts: { sheetId: string }) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    // TODO(phase-7): drop cast after activeDocument union widening
    const doc = state.activeDocument as unknown as { kind: string; document: DrawingDocument } | null;
    if (!doc || doc.kind !== 'drawing') return;

    if (doc.document.sheets.length <= 1) {
      throw new Error('LAST_SHEET: cannot delete the only sheet in a drawing');
    }

    const idx = doc.document.sheets.findIndex(s => s.id === this.opts.sheetId);
    if (idx === -1) return;

    this.prevSheet = doc.document.sheets[idx]!;
    this.prevSheetIndex = idx;
    this.prevActiveSheetId = doc.document.activeSheetId;

    const remaining = doc.document.sheets.filter(s => s.id !== this.opts.sheetId);
    const newActiveId =
      doc.document.activeSheetId === this.opts.sheetId
        ? (remaining[Math.max(0, idx - 1)]?.id ?? remaining[0]!.id)
        : doc.document.activeSheetId;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: remaining,
      activeSheetId: newActiveId,
    };
    // TODO(phase-7): drop cast after activeDocument union widening
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
  }

  async revert(): Promise<void> {
    if (!this.prevSheet || this.prevSheetIndex === -1) return;
    const state = useAppStore.getState();
    // TODO(phase-7): drop cast after activeDocument union widening
    const doc = state.activeDocument as unknown as { kind: string; document: DrawingDocument } | null;
    if (!doc || doc.kind !== 'drawing') return;

    const sheets = [...doc.document.sheets];
    sheets.splice(this.prevSheetIndex, 0, this.prevSheet);

    const next: DrawingDocument = {
      ...doc.document,
      sheets,
      activeSheetId: this.prevActiveSheetId ?? doc.document.activeSheetId,
    };
    // TODO(phase-7): drop cast after activeDocument union widening
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
    this.prevSheet = null;
    this.prevSheetIndex = -1;
  }
}
