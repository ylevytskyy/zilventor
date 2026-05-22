import type { Command } from './Command';
import type { DrawingDocument, DrawingSheet, SheetSize } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import type { ActiveDocument } from '../store/useAppStore';

export class CreateDrawingCommand implements Command {
  readonly name = 'CreateDrawing';
  private prevActiveDocument: ActiveDocument | null = null;
  private createdId: string | null = null;

  constructor(
    private readonly opts: {
      sourcePath: string;
      sourceKind: 'part' | 'assembly';
      sheetSize?: SheetSize;
      orientation?: 'landscape' | 'portrait';
    }
  ) {}

  async apply(): Promise<void> {
    this.prevActiveDocument = useAppStore.getState().activeDocument;

    const sheetId = crypto.randomUUID();
    const drawingId = crypto.randomUUID();
    this.createdId = drawingId;

    const size: SheetSize = this.opts.sheetSize ?? { kind: 'iso', size: 'A3' };

    const sheet: DrawingSheet = {
      id: sheetId,
      name: 'Sheet 1',
      size,
      orientation: this.opts.orientation ?? 'landscape',
      views: [],
      dimensions: [],
      annotations: [],
      titleBlock: {},
      dimensionGroups: [],
    };

    const doc: DrawingDocument = {
      id: drawingId,
      name: `${this.opts.sourcePath.split('/').pop()?.replace(/\.\w+$/, '') ?? 'Drawing'} — Drawing`,
      units: 'mm',
      source: {
        partPath: this.opts.sourcePath,
        sourceKind: this.opts.sourceKind,
      },
      properties: {},
      sheets: [sheet],
      activeSheetId: sheetId,
    };

    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: doc });

    // Persist to OPFS — fire-and-forget; errors surface in production via status bar
    try {
      const { saveDrawingToOpfs } = await import('../storage/saveDrawingToOpfs');
      await saveDrawingToOpfs(doc);
    } catch {
      // Non-fatal: drawing is in memory; user will be prompted to save explicitly
    }
  }

  async revert(): Promise<void> {
    useAppStore.getState().setActiveDocument(this.prevActiveDocument);

    if (this.createdId) {
      const id = this.createdId;
      this.createdId = null;
      try {
        const { deleteDrawingFromOpfs } = await import('../storage/deleteDrawingFromOpfs');
        await deleteDrawingFromOpfs(id);
      } catch {
        // Non-fatal: best-effort cleanup
      }
    }
  }
}
