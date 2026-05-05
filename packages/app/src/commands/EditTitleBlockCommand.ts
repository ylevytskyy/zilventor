import type { Command } from './Command';
import type { DrawingDocument, TitleBlockOverrides } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class EditTitleBlockCommand implements Command {
  readonly name = 'EditTitleBlock';
  private priorTitleBlock: TitleBlockOverrides | undefined;
  private reverted = false;

  constructor(private readonly opts: { sheetId: string; overrides: TitleBlockOverrides }) {}

  async apply(): Promise<void> {
    this.reverted = false;
    useAppStore.setState((s) => {
      if (s.activeDocument?.kind !== 'drawing') return s;
      const doc = s.activeDocument.document;
      const sheets = doc.sheets.map((sh) => {
        if (sh.id !== this.opts.sheetId) return sh;
        this.priorTitleBlock = sh.titleBlock;
        return { ...sh, titleBlock: this.opts.overrides };
      });
      const next: DrawingDocument = { ...doc, sheets };
      return { activeDocument: { kind: 'drawing' as const, document: next } } as never;
    });
  }

  async revert(): Promise<void> {
    if (this.priorTitleBlock === undefined || this.reverted) return;
    this.reverted = true;
    const prior = this.priorTitleBlock;
    useAppStore.setState((s) => {
      if (s.activeDocument?.kind !== 'drawing') return s;
      const doc = s.activeDocument.document;
      const sheets = doc.sheets.map((sh) =>
        sh.id === this.opts.sheetId ? { ...sh, titleBlock: prior } : sh,
      );
      const next: DrawingDocument = { ...doc, sheets };
      return { activeDocument: { kind: 'drawing' as const, document: next } } as never;
    });
  }
}
