import type { Command } from './Command';
import type { DrawingDocument, DrawingDimension } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class DeleteDrawingDimensionCommand implements Command {
  readonly name = 'DeleteDrawingDimension';
  private priorDim: DrawingDimension | undefined;
  private priorIndex = -1;
  private reverted = false;

  constructor(private readonly opts: { sheetId: string; dimId: string }) {}

  async apply(): Promise<void> {
    this.reverted = false;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheets = doc.document.sheets.map((sh) => {
      if (sh.id !== this.opts.sheetId) return sh;
      const idx = sh.dimensions.findIndex((d) => d.id === this.opts.dimId);
      if (idx === -1) return sh;
      this.priorDim = sh.dimensions[idx];
      this.priorIndex = idx;
      const dimensions = sh.dimensions.filter((d) => d.id !== this.opts.dimId);
      return { ...sh, dimensions };
    });
    const next: DrawingDocument = { ...doc.document, sheets };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } });
  }

  async revert(): Promise<void> {
    if (!this.priorDim || this.reverted) return;
    this.reverted = true;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const { priorDim, priorIndex } = this;
    const sheets = doc.document.sheets.map((sh) => {
      if (sh.id !== this.opts.sheetId) return sh;
      const dims = [...sh.dimensions];
      dims.splice(priorIndex, 0, priorDim!);
      return { ...sh, dimensions: dims };
    });
    const next: DrawingDocument = { ...doc.document, sheets };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } });
  }
}
