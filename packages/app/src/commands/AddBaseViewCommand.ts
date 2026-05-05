import type { Command } from './Command';
import type { DrawingDocument, ViewScale, BaseView } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

type BaseOrient = 'front' | 'top' | 'right' | 'back' | 'bottom' | 'left';

export class AddBaseViewCommand implements Command {
  readonly name = 'AddBaseView';
  private newViewId: string | null = null;

  constructor(
    private readonly opts: {
      sheetId: string;
      positionMm: { x: number; y: number };
      orientation: BaseOrient;
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

    const view: BaseView = {
      id: newId,
      kind: 'base',
      positionMm: this.opts.positionMm,
      orientation: this.opts.orientation,
      scale: this.opts.scale,
      showHidden: this.opts.showHidden ?? true,
    };

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: [...s.views, view] }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } });
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
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } });
    this.newViewId = null;
  }
}
