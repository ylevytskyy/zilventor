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

  // Step 2: assembly-sourced drawings — unpack .ziasm + loadAssemblyForProjection.
  if (doc.source.sourceKind === 'assembly') {
    // Assembly branch: unpack the .ziasm, load all visible leaf parts, build composed poses.
    try {
      const { loadAssemblyForProjection } = await import('./loadAssemblyForProjection');
      const { unpackAssembly } = await import('@zilventor/kernel/src/storage/AssemblyPacker');
      const asmBytes = await opfs.read(doc.source.partPath);
      const asmDoc = await unpackAssembly(asmBytes);
      const { components, sourceFingerprint } = await loadAssemblyForProjection({
        asmPath: doc.source.partPath,
        asmDoc,
        opfs,
        kernel,
      });
      useAppStore.setState({
        activeDrawingSourceComponents: components,
        activeDrawingSourceFingerprint: sourceFingerprint,
        activeDrawingSourceDocument: asmDoc,
      } as never);
      useAppStore.getState().setStatus('Opened');
    } catch (e) {
      console.warn('[activateDrawingDocument] assembly source load failed:', (e as Error).message);
      useAppStore.getState().setStatus(
        'Assembly source load failed — Regenerate disabled. Ensure all assembly parts are saved.',
      );
      useAppStore.setState({
        activeDrawingSourceComponents: null,
        activeDrawingSourceFingerprint: null,
        activeDrawingSourcePartId: null,
        activeDrawingSourceDocument: null,
      } as never);
    }
    return;
  }

  // Step 3 (part source): clear the module-level cache so a re-activation
  // picks up any edits made since the last session.
  _clearLoadDrawingSourceCache();

  try {
    const { partId, sourceFingerprint, sourceDocument } = await loadDrawingSource({
      partPath: doc.source.partPath,
      kernel,
      opfs,
      activePartId,
    });

    // Step 4: set the store slots — triggers DrawingCanvas staleness useEffect.
    useAppStore.setState({
      activeDrawingSourcePartId: partId,
      activeDrawingSourceFingerprint: sourceFingerprint,
      activeDrawingSourceDocument: sourceDocument,
    } as never);
    // Step 5: confirm success in the status bar. Doing this here (rather than in
    // FileTab) means the assembly/missing-source notices set above are never overwritten.
    useAppStore.getState().setStatus('Opened');
  } catch (e) {
    // Source part missing or kernel load failed. Drawing is already active (step 1)
    // and renders its saved projection. Regenerate is naturally disabled (slots null).
    // Non-blocking notice via status bar (setStatus) — not a modal error.
    console.warn('[activateDrawingDocument] source part load failed:', (e as Error).message);
    useAppStore.getState().setStatus(
      'Source part not found — Regenerate disabled. Open and re-save the part to restore.',
    );
    // Null slots explicitly so a prior drawing's source slots cannot bleed into this activation.
    useAppStore.setState({
      activeDrawingSourcePartId: null,
      activeDrawingSourceFingerprint: null,
      activeDrawingSourceComponents: null,
      activeDrawingSourceDocument: null,
    } as never);
  }
}
