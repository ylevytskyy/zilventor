import type { BoreOp } from './bore';

/**
 * Replace-with-merge: compute the new bores[] from a freshly-generated set,
 * preserving any user-edited bores and honouring suppressedConnectorIds.
 *
 * Contract:
 *   1. Build an editedById map from existing bores where bore.edited === true.
 *   2. Filter fresh: drop any bore whose connectorId OR id appears in `suppressed`.
 *   3. For each remaining fresh bore: if editedById has its id, substitute the
 *      existing (edited) bore; else use the fresh bore.
 *   Returns the merged array — NOT an append to existing.
 *
 * Absent-not-false contract (exactOptionalPropertyTypes): fresh bores must NOT
 * carry `edited: false` or `edited: undefined`; they must omit the key entirely.
 */
export function mergeBores(
  fresh: BoreOp[],
  existing: BoreOp[],
  suppressed: string[] | undefined,
): BoreOp[] {
  const editedById = new Map<string, BoreOp>();
  for (const b of existing) {
    if (b.edited === true) {
      editedById.set(b.id, b);
    }
  }

  const suppressedSet = new Set<string>(suppressed ?? []);

  const result: BoreOp[] = [];
  for (const b of fresh) {
    // Drop any bore suppressed by connectorId or by bore id.
    if (suppressedSet.has(b.connectorId) || suppressedSet.has(b.id)) continue;
    // If the user edited this bore, preserve their version.
    const edited = editedById.get(b.id);
    result.push(edited ?? b);
  }
  return result;
}
