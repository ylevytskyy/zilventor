import type { Command } from './Command';
import type { DrawingDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { drawingDocState } from '../store/drawingDocState';

export class MoveViewCommand implements Command {
  readonly name = 'MoveView';
  private prevPosition: { x: number; y: number } | null = null;

  constructor(
    private readonly opts: {
      sheetId: string;
      viewId: string;
      positionMm: { x: number; y: number };
    }
  ) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheet = doc.document.sheets.find(s => s.id === this.opts.sheetId);
    if (!sheet) return;

    const view = sheet.views.find(v => v.id === this.opts.viewId);
    if (!view) return;

    this.prevPosition = { ...view.positionMm };

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? {
              ...s,
              views: s.views.map(v =>
                v.id === this.opts.viewId
                  ? { ...v, positionMm: this.opts.positionMm }
                  : v
              ),
            }
          : s
      ),
    };
    useAppStore.setState(drawingDocState(next));
  }

  async revert(): Promise<void> {
    if (!this.prevPosition) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? {
              ...s,
              views: s.views.map(v =>
                v.id === this.opts.viewId
                  ? { ...v, positionMm: this.prevPosition! }
                  : v
              ),
            }
          : s
      ),
    };
    useAppStore.setState(drawingDocState(next));
    this.prevPosition = null;
  }
}
