import type { Command } from './Command';
import type { DrawingDocument, DrawingAnnotation } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

type Vec2 = { x: number; y: number };

export class MoveDrawingAnnotationCommand implements Command {
  readonly name = 'MoveDrawingAnnotation';
  private priorAnn: DrawingAnnotation | undefined;
  private reverted = false;

  constructor(private readonly opts: {
    sheetId: string;
    annId: string;
    textPosMm?: Vec2;
    targetMm?: Vec2;
  }) {}

  async apply(): Promise<void> {
    this.reverted = false;
    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheets = doc.document.sheets.map((sh) => {
      if (sh.id !== this.opts.sheetId) return sh;
      const annotations = sh.annotations.map((a) => {
        if (a.id !== this.opts.annId) return a;
        this.priorAnn = a;
        const updated = { ...a } as DrawingAnnotation;
        if (this.opts.textPosMm !== undefined && 'textPosMm' in updated) {
          (updated as { textPosMm: Vec2 }).textPosMm = this.opts.textPosMm;
        }
        if (this.opts.targetMm !== undefined && 'targetMm' in updated) {
          (updated as { targetMm: Vec2 }).targetMm = this.opts.targetMm;
        }
        return updated;
      });
      return { ...sh, annotations };
    });
    const next: DrawingDocument = { ...doc.document, sheets };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } });
  }

  async revert(): Promise<void> {
    if (!this.priorAnn || this.reverted) return;
    this.reverted = true;
    const prior = this.priorAnn;
    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheets = doc.document.sheets.map((sh) => {
      if (sh.id !== this.opts.sheetId) return sh;
      const annotations = sh.annotations.map((a) => (a.id === this.opts.annId ? prior : a));
      return { ...sh, annotations };
    });
    const next: DrawingDocument = { ...doc.document, sheets };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } });
  }
}
