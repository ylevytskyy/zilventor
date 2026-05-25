import type { Command } from './Command';
import type { DrawingDimension, DrawingDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { drawingDocState } from '../store/drawingDocState';

export class AddDrawingDimensionCommand implements Command {
  readonly name = 'AddDrawingDimension';

  constructor(private readonly opts: { sheetId: string; dim: DrawingDimension }) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map((sh) =>
        sh.id === this.opts.sheetId
          ? { ...sh, dimensions: [...sh.dimensions, this.opts.dim] }
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
          ? { ...sh, dimensions: sh.dimensions.filter((d) => d.id !== this.opts.dim.id) }
          : sh,
      ),
    };
    useAppStore.setState(drawingDocState(next));
  }
}
