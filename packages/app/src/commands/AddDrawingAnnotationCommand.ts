import type { Command } from './Command';
import type { DrawingDocument, DrawingAnnotation } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { drawingDocState } from '../store/drawingDocState';

export class AddDrawingAnnotationCommand implements Command {
  readonly name = 'AddDrawingAnnotation';

  constructor(private readonly opts: { sheetId: string; ann: DrawingAnnotation }) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map((sh) =>
        sh.id === this.opts.sheetId
          ? { ...sh, annotations: [...sh.annotations, this.opts.ann] }
          : sh,
      ),
    };
    useAppStore.setState(drawingDocState(next));
  }

  async revert(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map((sh) =>
        sh.id === this.opts.sheetId
          ? { ...sh, annotations: sh.annotations.filter((a) => a.id !== this.opts.ann.id) }
          : sh,
      ),
    };
    useAppStore.setState(drawingDocState(next));
  }
}
