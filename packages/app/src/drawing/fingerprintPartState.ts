// packages/app/src/drawing/fingerprintPartState.ts
import type { PartDocument } from '@zilventor/shared';

/** djb2 hash — browser-safe, synchronous. Matches fingerprint.ts convention. */
function djb2(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Synchronous fingerprint of a part's feature-tree and parameter state.
 * Hashes only `featureTree` and `parameters` — the two fields that change
 * when a part is edited. Name, id, materials, hardware are excluded so
 * metadata changes don't flag views as stale.
 *
 * Used by:
 *   - projectViewFromSource (at projection time, to record the source state)
 *   - DrawingCanvas activation effect (to detect staleness on drawing open)
 */
export function fingerprintPartState(partDoc: PartDocument): string {
  const payload = JSON.stringify({
    featureTree: partDoc.featureTree,
    parameters: partDoc.parameters,
  });
  return djb2(payload);
}
