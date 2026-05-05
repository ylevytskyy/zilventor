/**
 * Removes a DrawingDocument's OPFS file at `drawings/<id>.zidw`.
 *
 * NOTE: This module is dynamically imported by CreateDrawingCommand so
 * that unit tests can easily mock it with vi.mock.
 */
import { Opfs } from '@zilventor/kernel/src/storage/Opfs';

export async function deleteDrawingFromOpfs(id: string): Promise<void> {
  try {
    const opfs = await Opfs.forNavigator();
    await opfs.delete(`drawings/${id}.zidw`);
  } catch {
    // Non-fatal: file may not exist (e.g. save failed during apply)
  }
}
