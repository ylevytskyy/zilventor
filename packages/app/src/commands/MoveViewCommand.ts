import type { Command } from './Command';
import type { DrawingDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { drawingDocState } from '../store/drawingDocState';

type Pos = { x: number; y: number };

export class MoveViewCommand implements Command {
  readonly name = 'MoveView';
  // Prior positions of every view this command moved (the target view plus any
  // dependent projected views), keyed by view id. Null until applied.
  private prevPositions: Record<string, Pos> | null = null;

  constructor(
    private readonly opts: {
      sheetId: string;
      viewId: string;
      positionMm: Pos;
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

    // Enforced alignment: when a view moves, every projected view that depends on
    // it (baseViewId === movedId) shifts rigidly by the same delta so the layout
    // stays aligned. Snapshot the prior position of each moved view for revert.
    const delta: Pos = {
      x: this.opts.positionMm.x - view.positionMm.x,
      y: this.opts.positionMm.y - view.positionMm.y,
    };
    const moved: Record<string, Pos> = { [view.id]: this.opts.positionMm };
    const prev: Record<string, Pos> = { [view.id]: { ...view.positionMm } };
    for (const v of sheet.views) {
      if (v.kind === 'projected' && v.baseViewId === view.id) {
        prev[v.id] = { ...v.positionMm };
        moved[v.id] = { x: v.positionMm.x + delta.x, y: v.positionMm.y + delta.y };
      }
    }
    this.prevPositions = prev;

    useAppStore.setState(drawingDocState(this.withPositions(doc.document, moved)));
  }

  async revert(): Promise<void> {
    if (!this.prevPositions) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    useAppStore.setState(drawingDocState(this.withPositions(doc.document, this.prevPositions)));
    this.prevPositions = null;
  }

  private withPositions(document: DrawingDocument, positions: Record<string, Pos>): DrawingDocument {
    return {
      ...document,
      sheets: document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? {
              ...s,
              views: s.views.map(v =>
                positions[v.id] ? { ...v, positionMm: positions[v.id]! } : v
              ),
            }
          : s
      ),
    };
  }
}
