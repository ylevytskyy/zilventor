import type { Command } from './Command';
import type { DrawingDocument, DrawingSheet, SheetSize, PartDocument, AssemblyDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import type { ActiveDocument } from '../store/useAppStore';
import type { AssemblyComponentInput } from '@zilventor/kernel/src/adapter/drawing/getProjectorInput';

export class CreateDrawingCommand implements Command {
  readonly name = 'CreateDrawing';
  private prevActiveDocument: ActiveDocument | null = null;
  private prevActiveDrawingSourcePartId: string | null = null;
  private prevActiveDrawingSourceFingerprint: string | null = null;
  private prevActiveDrawingSourceComponents: AssemblyComponentInput[] | null = null;
  private prevActiveDrawingSourceDocument: PartDocument | AssemblyDocument | null = null;
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
      activeDrawingSourceComponents: AssemblyComponentInput[] | null;
      activeDrawingSourceDocument: PartDocument | AssemblyDocument | null;
    };
    this.prevActiveDrawingSourcePartId = prevSlots.activeDrawingSourcePartId;
    this.prevActiveDrawingSourceFingerprint = prevSlots.activeDrawingSourceFingerprint;
    this.prevActiveDrawingSourceComponents = prevSlots.activeDrawingSourceComponents;
    this.prevActiveDrawingSourceDocument = prevSlots.activeDrawingSourceDocument;
    // Capture activePart BEFORE setActiveDocument (which nulls activePart).
    const activePartDoc = state.activePart;
    // Capture activePart.id for OPFS-fallback partId in loadDrawingSource.
    const activePartId = activePartDoc?.id;
    // Capture activeAssembly BEFORE setActiveDocument (which could null it).
    const activeAsmDoc = state.activeAssembly;

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

    // Set the export source document unconditionally — independent of kernel readiness or
    // source-load success — so a prior drawing's source can never leak into this one. For a
    // create-from-part/assembly the captured activePartDoc/activeAsmDoc IS the source document.
    useAppStore.setState({
      activeDrawingSourceDocument:
        (this.opts.sourceKind === 'assembly' ? activeAsmDoc : activePartDoc) ?? null,
    } as never);

    // Load the source into the kernel so projection commands can call
    // getProjectorInput without a cache miss.
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
    } else if (this.opts.sourceKind === 'assembly') {
      // Assembly branch: load all visible parts + compute composite fingerprint.
      // activeAsmDoc is captured BEFORE setActiveDocument above (ordering guarantee).
      try {
        const { loadAssemblyForProjection } = await import('../drawing/loadAssemblyForProjection');
        const { Opfs } = await import('@zilventor/kernel/src/storage/Opfs');
        const kernel = useAppStore.getState().kernel;
        if (kernel && activeAsmDoc) {
          const opfs = await Opfs.forNavigator();
          const { components, sourceFingerprint } = await loadAssemblyForProjection({
            asmPath: this.opts.sourcePath,
            asmDoc: activeAsmDoc,
            opfs,
            kernel,
          });
          useAppStore.setState({
            activeDrawingSourceComponents: components,
            activeDrawingSourceFingerprint: sourceFingerprint,
          } as never);
        }
      } catch (e) {
        console.warn('[CreateDrawingCommand] assembly source load failed:', (e as Error).message);
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
      activeDrawingSourceComponents: this.prevActiveDrawingSourceComponents,
      activeDrawingSourceDocument: this.prevActiveDrawingSourceDocument,
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
