// packages/app/src/commands/AddHoleTableCommand.ts
import type { Command } from './Command';
import type { DrawingDocument, HoleTableAnnotation } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class AddHoleTableCommand implements Command {
  readonly name = 'AddHoleTable';

  constructor(
    private readonly opts: { sheetId: string; ann: HoleTableAnnotation },
  ) {}

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
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } });
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
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } });
  }
}
