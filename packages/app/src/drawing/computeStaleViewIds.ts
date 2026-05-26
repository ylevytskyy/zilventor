// packages/app/src/drawing/computeStaleViewIds.ts
import type { DrawingView } from '@zilventor/shared';

/**
 * Pure helper: computes the set of view ids that are stale given the current source fingerprint.
 *
 * Extracted from the DrawingCanvas activation useEffect for testability.
 *
 * @param views - all views on the active sheet
 * @param activeDrawingSourceFingerprint - djb2 hash of the source part's OPFS bytes, set by
 *   loadDrawingSource (B0). Null when no drawing is active or the source part has not loaded.
 *   NOTE: do NOT pass fingerprintPartState(activePart) here — activePart is null in the live
 *   drawing context. Use the store's activeDrawingSourceFingerprint slot instead.
 *
 * Staleness conditions:
 *   (a) view.projection exists but view.inputFingerprint is absent (legacy / hand-injected)
 *   (b) view.inputFingerprint !== activeDrawingSourceFingerprint (source bytes changed)
 *
 * Returns an empty set when activeDrawingSourceFingerprint is null (no source loaded yet).
 */
export function computeStaleViewIds(
  views: DrawingView[],
  activeDrawingSourceFingerprint: string | null,
): Set<string> {
  const stale = new Set<string>();
  for (const v of views) {
    if (!v.projection) continue; // unprojected views can't be stale
    if (!v.inputFingerprint) {
      stale.add(v.id); // (a) legacy: no fingerprint at all
    } else if (activeDrawingSourceFingerprint && v.inputFingerprint !== activeDrawingSourceFingerprint) {
      stale.add(v.id); // (b) fingerprint mismatch: source bytes changed since view was placed
    }
  }
  return stale;
}
