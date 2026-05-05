import type { Command } from './Command';
import type { DrawingDocument, DrawingAnnotation } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class AddDrawingAnnotationCommand implements Command {
  readonly name = 'AddDrawingAnnotation';

  constructor(private readonly opts: { sheetId: string; ann: DrawingAnnotation }) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    // TODO(phase-7): drop cast after activeDocument union widening
    const doc = state.activeDocument as unknown as { kind: string; document: DrawingDocument } | null;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map((sh) =>
        sh.id === this.opts.sheetId
          ? { ...sh, annotations: [...sh.annotations, this.opts.ann] }
          : sh,
      ),
    };
    // TODO(phase-7): drop cast after activeDocument union widening
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
  }

  async revert(): Promise<void> {
    const state = useAppStore.getState();
    // TODO(phase-7): drop cast after activeDocument union widening
    const doc = state.activeDocument as unknown as { kind: string; document: DrawingDocument } | null;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map((sh) =>
        sh.id === this.opts.sheetId
          ? { ...sh, annotations: sh.annotations.filter((a) => a.id !== this.opts.ann.id) }
          : sh,
      ),
    };
    // TODO(phase-7): drop cast after activeDocument union widening
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
  }
}
