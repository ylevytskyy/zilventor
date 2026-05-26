/**
 * Shared drawing open/activate routine.
 *
 * Called by FileTab.handleOpen (reopen) and extensible for other activation points.
 * Mirrors CreateDrawingCommand steps 1–4 minus the create-only saveDrawingToOpfs.
 *
 * Takes explicit kernel + opfs args (not from store) so unit tests can inject mocks
 * exactly like CreateDrawingCommand.spec does with vi.mock.
 */
import type { DrawingDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import type { KernelForLoad, OpfsForLoad } from './loadDrawingSource';
import { loadDrawingSource, _clearLoadDrawingSourceCache } from './loadDrawingSource';

export async function activateDrawingDocument(
  doc: DrawingDocument,
  { kernel, opfs }: { kernel: KernelForLoad; opfs: OpfsForLoad },
): Promise<void> {
  // Step 1: activate the drawing as the active document.
  // setActiveDocument does NOT reset activeDrawingSourcePartId / activeDrawingSourceFingerprint —
  // we set them explicitly below.
  // Read activePartId BEFORE setActiveDocument (which nulls activePart), mirroring
  // CreateDrawingCommand.ts lines 33 + 85. In the reopen path activePart is usually null
  // (harmless no-op), but preserves the test-fixture fallback in loadDrawingSource.
  const activePartId = useAppStore.getState().activePart?.id;
  useAppStore.getState().setActiveDocument({ kind: 'drawing', document: doc });

  // Step 2: skip source-load for assembly-sourced drawings (separate deferred work).
  if (doc.source.sourceKind === 'assembly') {
    // Slots stay null; Regenerate naturally disabled.
    useAppStore.getState().setStatus(
      'Assembly-sourced drawing opened — Regenerate unavailable (assembly projection is deferred)',
    );
    return;
  }

  // Step 3 (part source): clear the module-level cache so a re-activation
  // picks up any edits made since the last session.
  _clearLoadDrawingSourceCache();

  try {
    const { partId, sourceFingerprint } = await loadDrawingSource({
      partPath: doc.source.partPath,
      kernel,
      opfs,
      activePartId,
    });

    // Step 4: set the store slots — triggers DrawingCanvas staleness useEffect.
    useAppStore.setState({
      activeDrawingSourcePartId: partId,
      activeDrawingSourceFingerprint: sourceFingerprint,
    } as never);
  } catch (e) {
    // Source part missing or kernel load failed. Drawing is already active (step 1)
    // and renders its saved projection. Regenerate is naturally disabled (slots null).
    // Non-blocking notice via status bar (setStatus) — not a modal error.
    console.warn('[activateDrawingDocument] source part load failed:', (e as Error).message);
    useAppStore.getState().setStatus(
      'Source part not found — Regenerate disabled. Open and re-save the part to restore.',
    );
    // Ensure slots are explicitly null (they may have had a previous value from a prior drawing).
    useAppStore.setState({
      activeDrawingSourcePartId: null,
      activeDrawingSourceFingerprint: null,
    } as never);
  }
}
