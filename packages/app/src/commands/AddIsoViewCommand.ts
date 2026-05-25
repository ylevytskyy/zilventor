import type { Command } from './Command';
import type { DrawingDocument, ViewScale, IsoView } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { drawingDocState } from '../store/drawingDocState';

export class AddIsoViewCommand implements Command {
  readonly name = 'AddIsoView';
  private newViewId: string | null = null;

  constructor(
    private readonly opts: {
      sheetId: string;
      positionMm: { x: number; y: number };
      corner: 'NE' | 'NW' | 'SE' | 'SW';
      scale: ViewScale;
      showHidden?: boolean;
    }
  ) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const newId = crypto.randomUUID();
    this.newViewId = newId;

    const view: IsoView = {
      id: newId,
      kind: 'iso',
      positionMm: this.opts.positionMm,
      corner: this.opts.corner,
      scale: this.opts.scale,
      showHidden: this.opts.showHidden ?? false, // engineering convention
    };

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: [...s.views, view] }
          : s
      ),
    };
    useAppStore.setState(drawingDocState(next));
  }

  async revert(): Promise<void> {
    if (!this.newViewId) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: s.views.filter(v => v.id !== this.newViewId) }
          : s
      ),
    };
    useAppStore.setState(drawingDocState(next));
    this.newViewId = null;
  }
}
