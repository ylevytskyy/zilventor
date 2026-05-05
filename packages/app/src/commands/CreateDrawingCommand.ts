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
      orientation: 'landscape',
      views: [],
      dimensions: [],
      annotations: [],
      titleBlock: {},
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

    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: doc },
      activePart: null,
      activeAssembly: null,
    } as never);

    // Persist to OPFS — fire-and-forget; errors surface in production via status bar
    try {
      const { saveDrawingToOpfs } = await import('../storage/saveDrawingToOpfs');
      await saveDrawingToOpfs(doc);
    } catch {
      // Non-fatal: drawing is in memory; user will be prompted to save explicitly
    }
  }

  async revert(): Promise<void> {
    useAppStore.setState({
      activeDocument: this.prevActiveDocument,
      activePart:
        this.prevActiveDocument?.kind === 'part'
          ? this.prevActiveDocument.document
          : null,
      activeAssembly:
        this.prevActiveDocument?.kind === 'assembly'
          ? this.prevActiveDocument.document
          : null,
    } as never);
    this.createdId = null;
  }
}
