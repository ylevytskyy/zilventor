/**
 * Boot-restore helper. Called once on cold-boot after kernel+opfs are ready.
 * Reads the last-open pointer from localStorage, loads the document from OPFS,
 * and activates it. Dispatches on kind: drawing | part | assembly.
 *
 * Returns true on success, false on any graceful failure (no pointer, file
 * missing, corrupt bytes, kernel error). Never throws — a failed restore must
 * not crash the app.
 */
import type { PartDocument } from '@zilventor/shared';
import { getLastOpenDocument, clearLastOpen } from '../storage/lastOpenDocument';
import { unpackDrawing } from '../storage/DrawingPacker';
import { unpackAssemblyWithTextures } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { activateDrawingDocument } from './activateDrawingDocument';
import { useAppStore } from '../store/useAppStore';
import type { OpfsForLoad } from './loadDrawingSource';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { globalCustomTextureRegistry } from '../textures/customTextureRegistry';

export type KernelForRestore = {
  loadFromBytes(bytes: Uint8Array): Promise<string>;
  execute(partId: string): Promise<{ ok: boolean; value?: unknown; error?: unknown }>;
  getPart(partId: string): Promise<PartDocument | null>; // real KernelApi.getPart is nullable
};

export async function restoreLastOpenDocument({
  kernel,
  opfs,
}: {
  kernel: KernelForRestore;
  opfs: OpfsForLoad;
}): Promise<boolean> {
  const pointer = getLastOpenDocument();
  if (!pointer) return false;

  try {
    const exists = await opfs.exists(pointer.opfsPath);
    if (!exists) {
      clearLastOpen();
      return false;
    }
    const bytes = await opfs.read(pointer.opfsPath);

    if (pointer.kind === 'drawing') {
      const doc = await unpackDrawing(bytes);
      // KernelForRestore is a structural superset of KernelForLoad — passes directly.
      await activateDrawingDocument(doc, { kernel, opfs });
      return true;
    }

    if (pointer.kind === 'assembly') {
      const { doc, textures } = await unpackAssemblyWithTextures(bytes);
      // Rebuild the custom-texture runtime registry from the packed bytes.
      globalCustomTextureRegistry.revokeAll();
      const asmDefs = doc.customTextures ?? [];
      if (asmDefs.length && Object.keys(textures).length) {
        globalCustomTextureRegistry.register(asmDefs, textures);
      }
      useAppStore.getState().setActiveDocument({ kind: 'assembly', document: doc });
      return true;
    }

    // part
    const partId = await kernel.loadFromBytes(bytes);
    // Rebuild the custom-texture runtime registry from the packed bytes.
    try {
      const { manifest, textures } = await unpackProject(bytes);
      globalCustomTextureRegistry.revokeAll();
      const partDefs = (manifest as { document?: { customTextures?: unknown[] } }).document?.customTextures ?? [];
      if (partDefs.length && textures && Object.keys(textures).length) {
        globalCustomTextureRegistry.register(partDefs as Parameters<typeof globalCustomTextureRegistry.register>[0], textures);
      }
    } catch {
      // Non-fatal — custom textures just won't render until re-uploaded.
    }
    const res = await kernel.execute(partId);
    if (!res.ok) {
      clearLastOpen();
      return false;
    }
    const part = await kernel.getPart(partId);
    if (!part) {
      // getPart is nullable — a missing part must not become a null active doc.
      clearLastOpen();
      return false;
    }
    useAppStore.getState().setActiveDocument({ kind: 'part', document: part });
    return true;
  } catch {
    clearLastOpen();
    return false;
  }
}
