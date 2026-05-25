import type { Command } from './Command';
import type { DrawingDocument, TitleBlockOverrides } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { drawingDocState } from '../store/drawingDocState';

export class EditTitleBlockCommand implements Command {
  readonly name = 'EditTitleBlock';
  private priorTitleBlock: TitleBlockOverrides | undefined;
  private reverted = false;

  constructor(private readonly opts: { sheetId: string; overrides: TitleBlockOverrides }) {}

  async apply(): Promise<void> {
    this.reverted = false;
    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheets = doc.document.sheets.map((sh) => {
      if (sh.id !== this.opts.sheetId) return sh;
      this.priorTitleBlock = sh.titleBlock;
      return { ...sh, titleBlock: this.opts.overrides };
    });
    const next: DrawingDocument = { ...doc.document, sheets };
    useAppStore.setState(drawingDocState(next));
  }

  async revert(): Promise<void> {
    if (this.priorTitleBlock === undefined || this.reverted) return;
    this.reverted = true;
    const prior = this.priorTitleBlock;
    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheets = doc.document.sheets.map((sh) =>
      sh.id === this.opts.sheetId ? { ...sh, titleBlock: prior } : sh,
    );
    const next: DrawingDocument = { ...doc.document, sheets };
    useAppStore.setState(drawingDocState(next));
  }
}
