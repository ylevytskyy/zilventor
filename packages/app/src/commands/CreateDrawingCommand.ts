import type { Command } from './Command';
import type { DrawingDocument, DrawingSheet, SheetSize } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import type { ActiveDocument } from '../store/useAppStore';

export class CreateDrawingCommand implements Command {
  readonly name = 'CreateDrawing';
  private prevActiveDocument: ActiveDocument | null = null;
  private prevActiveDrawingSourcePartId: string | null = null;
  private prevActiveDrawingSourceFingerprint: string | null = null;
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
    const state = useAppStore.getState();
    this.prevActiveDocument = state.activeDocument;
    const prevSlots = state as unknown as {
      activeDrawingSourcePartId: string | null;
      activeDrawingSourceFingerprint: string | null;
    };
    this.prevActiveDrawingSourcePartId = prevSlots.activeDrawingSourcePartId;
    this.prevActiveDrawingSourceFingerprint = prevSlots.activeDrawingSourceFingerprint;
    // Capture activePart.id BEFORE setActiveDocument (which nulls activePart).
    // Used as the OPFS-fallback partId when partPath = `${partId}.zipt` (e2e test path).
    const activePartId = state.activePart?.id;

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

    // Load the source part into the kernel so projection commands can call
    // getProjectorInput without a cache miss. Only for part-sourced drawings —
    // assembly-sourced drawings use a different load path (future work).
    if (this.opts.sourceKind === 'part') {
      try {
        const { loadDrawingSource, _clearLoadDrawingSourceCache } = await import('../drawing/loadDrawingSource');
        const { Opfs } = await import('@zilventor/kernel/src/storage/Opfs');
        const kernel = useAppStore.getState().kernel;
        if (kernel) {
          const opfs = await Opfs.forNavigator();
          // Clear the module-level cache so re-activating the same drawing picks up
          // any edits made since the last activation (fresh OPFS read each time).
          _clearLoadDrawingSourceCache();
          const { partId, sourceFingerprint } = await loadDrawingSource({
            partPath: this.opts.sourcePath,
            kernel,
            opfs,
            activePartId,
          });
          useAppStore.setState({
            activeDrawingSourcePartId: partId,
            activeDrawingSourceFingerprint: sourceFingerprint,
          } as never);
        }
      } catch (e) {
        // Non-fatal: source part failed to load. Views will throw PART_NOT_IN_STORE
        // when the user tries to place them; the user can retry.
        console.warn('[CreateDrawingCommand] source part load failed:', (e as Error).message);
      }
    }

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
    useAppStore.setState({
      activeDrawingSourcePartId: this.prevActiveDrawingSourcePartId,
      activeDrawingSourceFingerprint: this.prevActiveDrawingSourceFingerprint,
    } as never);

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
