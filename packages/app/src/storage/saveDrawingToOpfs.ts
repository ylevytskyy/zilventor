/**
 * Persists a DrawingDocument to OPFS under `drawings/<id>.zidw`.
 *
 * Uses packDrawing() — the same serializer used by unpackDrawing (handleOpen).
 *
 * NOTE: This module is dynamically imported by CreateDrawingCommand so
 * that unit tests can easily mock it with vi.mock.
 */
import type { DrawingDocument } from '@zilventor/shared';
import { packDrawing } from './DrawingPacker';
import { Opfs } from '@zilventor/kernel/src/storage/Opfs';

export async function saveDrawingToOpfs(doc: DrawingDocument): Promise<void> {
  const bytes = await packDrawing(doc);
  const opfs = await Opfs.forNavigator();
  await opfs.write(`drawings/${doc.id}.zidw`, bytes);
}
