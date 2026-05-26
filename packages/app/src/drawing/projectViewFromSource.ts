// packages/app/src/drawing/projectViewFromSource.ts
import { projectView } from '@zilventor/shared';
import type { ViewOrientation } from '@zilventor/shared';
import type { ProjectedGeometry } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { fingerprintPartState } from './fingerprintPartState';

export type ProjectViewResult = {
  projection: ProjectedGeometry;
  inputFingerprint: string;
};

/**
 * Shared async helper called by AddBaseViewCommand, AddProjectedViewCommand,
 * AddIsoViewCommand, and handleRegenerate.
 *
 * Kernel partId resolution (in priority order):
 *   1. state.activeDrawingSourcePartId  — set by B0 (CreateDrawingCommand → loadDrawingSource).
 *      This is the live-app path. drawingDocState() sets activePart=null, so we cannot
 *      use activePart.id here in production.
 *   2. state.activePart?.id             — fallback for unit tests that inject activePart
 *      directly via setState (mirrors existing test fixture pattern).
 *
 * inputFingerprint resolution (parallel to partId):
 *   1. state.activeDrawingSourceFingerprint — djb2 hash of raw OPFS bytes (set by B0
 *      loadDrawingSource). Changes when the source .zipt file changes → staleness works.
 *      MUST NOT be replaced with djb2(kernelId): kernel UUIDs are session-stable and would
 *      never change on source edits.
 *   2. fingerprintPartState(activePart) — fallback for unit-test path.
 *
 * Throws 'KERNEL_NOT_READY' if kernel is null.
 * Throws 'PART_NOT_IN_STORE' if both activeDrawingSourcePartId and activePart are null.
 * Throws 'GEOMETRY_NOT_CACHED' if getProjectorInput returns null (part not in cache).
 *   NOTE: getProjectorInput returns null — NOT throws — on cache miss (api.ts:93).
 */
export async function projectViewFromSource(
  orientation: ViewOrientation,
): Promise<ProjectViewResult> {
  const state = useAppStore.getState();

  const kernel = state.kernel;
  if (!kernel) throw new Error('KERNEL_NOT_READY: kernel not initialized');

  // Resolve kernel partId: live path first, then test fallback.
  const kernelId: string | null =
    state.activeDrawingSourcePartId ??
    state.activePart?.id ??
    null;

  if (!kernelId) {
    throw new Error(
      'PART_NOT_IN_STORE: activeDrawingSourcePartId is null and activePart is null. ' +
      'Ensure the drawing source part was loaded via CreateDrawingCommand (B0) before placing views.'
    );
  }

  // getProjectorInput returns null when the part is not in the kernel's namedShapeCache.
  // It does NOT throw. Return value contract confirmed at packages/kernel/src/api.ts:93.
  const input = await kernel.getProjectorInput({ kind: 'part', partId: kernelId });
  if (input === null) {
    throw new Error(
      `GEOMETRY_NOT_CACHED: kernel.getProjectorInput returned null for partId "${kernelId}". ` +
      'The source part is not in the kernel cache. Ensure loadDrawingSource (B0) loaded and executed it.'
    );
  }

  const projection = projectView(input, orientation);

  // Fingerprint: live-app path reads activeDrawingSourceFingerprint (bytes hash from OPFS, B0).
  // Fallback for unit-test path: fingerprintPartState(activePart) — featureTree+parameters hash.
  const inputFingerprint =
    state.activeDrawingSourceFingerprint ??
    (state.activePart ? fingerprintPartState(state.activePart) : kernelId);

  return { projection, inputFingerprint };
}
