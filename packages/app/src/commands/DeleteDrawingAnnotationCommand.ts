import type { Command } from './Command';
import type { DrawingDocument, DrawingAnnotation } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class DeleteDrawingAnnotationCommand implements Command {
  readonly name = 'DeleteDrawingAnnotation';
  private priorAnn: DrawingAnnotation | undefined;
  private priorIndex = -1;
  private reverted = false;

  constructor(private readonly opts: { sheetId: string; annId: string }) {}

  async apply(): Promise<void> {
    this.reverted = false;
    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheets = doc.document.sheets.map((sh) => {
      if (sh.id !== this.opts.sheetId) return sh;
      const idx = sh.annotations.findIndex((a) => a.id === this.opts.annId);
      if (idx === -1) return sh;
      this.priorAnn = sh.annotations[idx];
      this.priorIndex = idx;
      const annotations = sh.annotations.filter((a) => a.id !== this.opts.annId);
      return { ...sh, annotations };
    });
    const next: DrawingDocument = { ...doc.document, sheets };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } });
  }

  async revert(): Promise<void> {
    if (!this.priorAnn || this.reverted) return;
    this.reverted = true;
    const { priorAnn, priorIndex } = this;
    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheets = doc.document.sheets.map((sh) => {
      if (sh.id !== this.opts.sheetId) return sh;
      const anns = [...sh.annotations];
      anns.splice(priorIndex, 0, priorAnn!);
      return { ...sh, annotations: anns };
    });
    const next: DrawingDocument = { ...doc.document, sheets };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } });
  }
}
