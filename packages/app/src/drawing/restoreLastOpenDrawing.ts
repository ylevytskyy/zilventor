/**
 * Boot-restore helper. Called once on cold-boot after kernel+opfs are ready.
 * Reads the last-open pointer from localStorage, loads the .zidw from OPFS,
 * unpacks it, and activates the drawing document.
 *
 * Returns true on success, false on any graceful failure (no pointer, file
 * missing, corrupt bytes). Never throws — a failed restore must not crash the app.
 */
import { getLastOpenDrawing, clearLastOpen } from '../storage/lastOpenDocument';
import { unpackDrawing } from '../storage/DrawingPacker';
import { activateDrawingDocument } from './activateDrawingDocument';
import type { KernelForLoad, OpfsForLoad } from './loadDrawingSource';

export async function restoreLastOpenDrawing({
  kernel,
  opfs,
}: {
  kernel: KernelForLoad;
  opfs: OpfsForLoad;
}): Promise<boolean> {
  const pointer = getLastOpenDrawing();
  if (!pointer) return false;

  try {
    const exists = await opfs.exists(pointer.opfsPath);
    if (!exists) {
      clearLastOpen();
      return false;
    }

    const bytes = await opfs.read(pointer.opfsPath);
    const doc = await unpackDrawing(bytes);
    await activateDrawingDocument(doc, { kernel, opfs });
    return true;
  } catch {
    clearLastOpen();
    return false;
  }
}
