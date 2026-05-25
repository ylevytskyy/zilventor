import type { Command } from './Command';
import type { SheetSize, DrawingDocument, DrawingSheet } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { drawingDocState } from '../store/drawingDocState';

export class AddSheetCommand implements Command {
  readonly name = 'AddSheet';
  private prevActiveSheetId: string | null = null;
  private newSheetId: string | null = null;

  constructor(
    private readonly opts: {
      size?: SheetSize;
      orientation?: 'landscape' | 'portrait';
    }
  ) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    this.prevActiveSheetId = doc.document.activeSheetId;
    const newId = crypto.randomUUID();
    this.newSheetId = newId;

    const existingCount = doc.document.sheets.length;
    const newSheet: DrawingSheet = {
      id: newId,
      name: `Sheet ${existingCount + 1}`,
      size: this.opts.size ?? { kind: 'iso', size: 'A3' },
      orientation: this.opts.orientation ?? 'landscape',
      views: [],
      dimensions: [],
      annotations: [],
      titleBlock: {},
      dimensionGroups: [],
    };

    const next: DrawingDocument = {
      ...doc.document,
      sheets: [...doc.document.sheets, newSheet],
      activeSheetId: newId,
    };
    useAppStore.setState(drawingDocState(next));
  }

  async revert(): Promise<void> {
    if (!this.newSheetId) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.filter(s => s.id !== this.newSheetId),
      activeSheetId: this.prevActiveSheetId ?? doc.document.sheets[0]!.id,
    };
    useAppStore.setState(drawingDocState(next));
    this.newSheetId = null;
  }
}
