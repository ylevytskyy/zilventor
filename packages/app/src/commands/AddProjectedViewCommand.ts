import type { Command } from './Command';
import type { DrawingDocument, ProjectedView, BaseView } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class AddProjectedViewCommand implements Command {
  readonly name = 'AddProjectedView';
  private newViewId: string | null = null;

  constructor(
    private readonly opts: {
      sheetId: string;
      baseViewId: string;
      direction: 'top' | 'bottom' | 'left' | 'right';
      positionMm: { x: number; y: number };
    }
  ) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheet = doc.document.sheets.find(s => s.id === this.opts.sheetId);
    if (!sheet) return;

    const baseView = sheet.views.find(
      (v): v is BaseView => v.id === this.opts.baseViewId && v.kind === 'base'
    );
    if (!baseView) {
      throw new Error(`BASE_VIEW_NOT_FOUND: no base view with id ${this.opts.baseViewId} on sheet ${this.opts.sheetId}`);
    }

    const newId = crypto.randomUUID();
    this.newViewId = newId;

    const view: ProjectedView = {
      id: newId,
      kind: 'projected',
      positionMm: this.opts.positionMm,
      baseViewId: this.opts.baseViewId,
      direction: this.opts.direction,
      scale: baseView.scale,  // inherit from base
      showHidden: baseView.showHidden,
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
