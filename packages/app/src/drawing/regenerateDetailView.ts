// packages/app/src/drawing/regenerateDetailView.ts
import type { DetailView, DrawingView, DrawingDocument } from '@zilventor/shared';
import { projectDetailView, fingerprintDetailView } from '@zilventor/shared';
import type { CommandBus } from '../commands/CommandBus';
import { RegenerateViewCommand } from '../commands/RegenerateViewCommand';
import { useAppStore } from '../store/useAppStore';

/**
 * Async helper for handleRegenerate — detail-view path.
 *
 * 1. If the parent is stale, regenerate it first via regenerateParent callback
 *    (which handles base/projected/iso/section depending on kind).
 * 2. Read the parent's FRESH projection from the live store (not stale closure).
 * 3. Re-clip via projectDetailView.
 * 4. Recompute inputFingerprint via fingerprintDetailView.
 * 5. Commit via RegenerateViewCommand.
 *
 * Throws if parent regenerate fails (caller keeps detail stale).
 */
export async function regenerateDetailView(
  view: DetailView,
  sheetId: string,
  bus: CommandBus,
  parentIsStale: (parentId: string) => boolean,
  regenerateParent: (parentView: DrawingView) => Promise<void>,
): Promise<void> {
  // Step 1: resolve live drawing doc.
  const stateBeforeCascade = useAppStore.getState();
  const docBefore = stateBeforeCascade.activeDocument;
  if (!docBefore || docBefore.kind !== 'drawing') throw new Error('REGEN_DETAIL: no active drawing');
  const drawingBefore = docBefore.document as DrawingDocument;

  // Step 2: cascade — regenerate parent if stale.
  if (parentIsStale(view.parentViewId)) {
    const parentView = drawingBefore.sheets
      .flatMap((s) => s.views)
      .find((v) => v.id === view.parentViewId);
    if (!parentView) throw new Error(`REGEN_DETAIL: parentViewId "${view.parentViewId}" not found`);
    // This may throw — let it propagate so the detail stays stale.
    await regenerateParent(parentView);
  }

  // Step 3: read FRESH state after potential parent regen.
  const liveState = useAppStore.getState();
  const liveDoc = liveState.activeDocument;
  if (!liveDoc || liveDoc.kind !== 'drawing') throw new Error('REGEN_DETAIL: drawing disappeared');
  const liveDrawing = liveDoc.document as DrawingDocument;

  const liveParent = liveDrawing.sheets
    .flatMap((s) => s.views)
    .find((v) => v.id === view.parentViewId);
  if (!liveParent || !liveParent.projection) {
    throw new Error(`REGEN_DETAIL: parent "${view.parentViewId}" missing projection after cascade`);
  }

  // Step 4: re-clip via pure-2D projectDetailView.
  const projection = projectDetailView({
    parentView: liveParent as Parameters<typeof projectDetailView>[0]['parentView'],
    regionParent: view.regionParent,
    detailScale: view.scale,
    showHidden: view.showHidden,
  });

  // Step 5: recompute fingerprint = djb2(parent inputFingerprint + regionParent + scale).
  const parentFp = (liveParent as { inputFingerprint?: string }).inputFingerprint ?? '';
  const inputFingerprint = fingerprintDetailView(parentFp, view.regionParent, view.scale);

  // Step 6: commit via RegenerateViewCommand.
  await bus.execute(new RegenerateViewCommand({
    sheetId,
    viewId: view.id,
    projection,
    inputFingerprint,
  }));
}
