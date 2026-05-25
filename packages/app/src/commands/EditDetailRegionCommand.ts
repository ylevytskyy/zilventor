// packages/app/src/commands/EditDetailRegionCommand.ts
import type { Command } from './Command';
import type { DetailView, DrawingDocument, RegionParent } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { reprojectDetailRegion } from './reprojectDetailRegion';

export type EditDetailRegionOpts = {
  sheetId: string;
  detailViewId: string;
  prevRegion: RegionParent;
  newRegion:  RegionParent;
};

export class EditDetailRegionCommand implements Command {
  readonly name = 'EditDetailRegion';

  constructor(private readonly opts: EditDetailRegionOpts) {}

  async apply(): Promise<void> {
    this._write(this.opts.newRegion);
  }

  async revert(): Promise<void> {
    this._write(this.opts.prevRegion);
  }

  private _write(region: RegionParent): void {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const drawing = doc.document;
    const sheet = drawing.sheets.find(s => s.id === this.opts.sheetId);
    if (!sheet) return;

    const detail = sheet.views.find(v => v.id === this.opts.detailViewId);
    if (!detail || detail.kind !== 'detail') return;
    const detailView = detail as DetailView;

    const parentView = sheet.views.find(v => v.id === detailView.parentViewId);
    if (!parentView || !parentView.projection) return;

    const next = reprojectDetailRegion(
      detailView,
      parentView as typeof parentView & { projection: NonNullable<typeof parentView['projection']> },
      region,
    );

    const nextDoc: DrawingDocument = {
      ...drawing,
      sheets: drawing.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: s.views.map(v => v.id === this.opts.detailViewId ? next : v) }
          : s
      ),
    };
    // F6 gotcha: DrawingCanvas subscribes to activeDrawing — must set BOTH.
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc });
  }
}
