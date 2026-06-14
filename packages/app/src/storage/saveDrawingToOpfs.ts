/**
 * Persists a DrawingDocument to OPFS under `drawings/<id>.zidw`.
 *
 * Uses packDrawing() — the same serializer used by unpackDrawing (handleOpen).
 * The write is wrapped in withOpfsLock (matching the autosave lock-name scheme
 * `opfs:drawings/<id>.zidw`) so concurrent autosave and explicit save don't
 * race on the same file.
 *
 * NOTE: This module is dynamically imported by CreateDrawingCommand so
 * that unit tests can easily mock it with vi.mock.
 */
import type { DrawingDocument } from '@zilventor/shared';
import { packDrawing } from './DrawingPacker';
import { withOpfsLock } from './autosaveDrawing';
import { Opfs } from '@zilventor/kernel/src/storage/Opfs';

export async function saveDrawingToOpfs(doc: DrawingDocument): Promise<void> {
  const path = `drawings/${doc.id}.zidw`;
  const bytes = await packDrawing(doc);
  const opfs = await Opfs.forNavigator();
  await withOpfsLock(`opfs:${path}`, () => opfs.write(path, bytes));
}
