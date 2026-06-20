import type { Command } from './Command';
import type { DrawingDocument, DrawingTemplate } from '@zilventor/shared';
import { applyTemplateToNewSheet } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { drawingDocState } from '../store/drawingDocState';

/** Create a new sheet from a drawing template (Milestone 3.3). Mirrors AddSheetCommand. */
export class AddSheetFromTemplateCommand implements Command {
  readonly name = 'AddSheetFromTemplate';
  private prevActiveSheetId: string | null = null;
  private newSheetId: string | null = null;

  constructor(private readonly opts: { template: DrawingTemplate }) {}

  async apply(): Promise<void> {
    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    this.prevActiveSheetId = doc.document.activeSheetId;
    const newId = crypto.randomUUID();
    this.newSheetId = newId;

    const existingCount = doc.document.sheets.length;
    const baseName = this.opts.template.name.trim();
    const newSheet = applyTemplateToNewSheet(this.opts.template, {
      id: newId,
      name: baseName.length > 0 ? baseName : `Sheet ${existingCount + 1}`,
    });

    const next: DrawingDocument = {
      ...doc.document,
      sheets: [...doc.document.sheets, newSheet],
      activeSheetId: newId,
    };
    useAppStore.setState(drawingDocState(next));
  }

  async revert(): Promise<void> {
    if (!this.newSheetId) return;
    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.filter((s) => s.id !== this.newSheetId),
      activeSheetId: this.prevActiveSheetId ?? doc.document.sheets[0]!.id,
    };
    useAppStore.setState(drawingDocState(next));
    this.newSheetId = null;
  }
}
