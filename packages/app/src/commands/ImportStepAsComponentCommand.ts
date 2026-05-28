import type { Command } from './Command';
import type { KernelApi } from '@zilventor/kernel/src/api';
import type { ComponentInstance, PartDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { buildImportedPartDocument } from '../import/buildImportedPartDocument';
import { dedupeName } from '../import/dedupeName';
import { stepFilenameBasename } from '../import/originFeatures';

export type OpfsLike = {
  write(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  listAll(): Promise<string[]>;
};

export type ImportStepAsComponentOpts = {
  stepBytes: ArrayBuffer;
  fileName: string;
  kernel: Pick<KernelApi, 'importStep' | 'registerPart' | 'deletePart' | 'saveToBytes'>;
  opfs: OpfsLike;
};

/**
 * Atomic command: import a STEP file and (when an assembly is active)
 * insert it as a new component at the assembly origin.
 *
 * When no assembly is active (part- or drawing-active), behaves like
 * importStepIntoNewPart: creates a standalone top-level part and switches
 * the active document to it.
 *
 * Undo: removes the component + evicts the part from OPFS + kernel cache.
 * Redo: re-registers from in-memory bytes + re-persists + re-inserts.
 */
export class ImportStepAsComponentCommand implements Command {
  readonly name = 'ImportStepAsComponent';

  // Captured during apply() for undo/redo
  private placedId: string | null = null;
  private placedPartId: string | null = null;
  private placedPartPath: string | null = null;
  private placedPart: PartDocument | null = null;
  private placedArchiveBytes: Uint8Array | null = null;
  /** Whether apply() ran the assembly path (true) or standalone-part path (false). */
  private wasAssemblyInsert = false;

  /** Saved state for redo: avoids re-calling importStep (blob stays in cache). */
  private redoState: {
    partName: string;
    brepBlobId: string;
    fileName: string;
    partPath: string;
    archiveBytes: Uint8Array;
  } | null = null;

  constructor(private opts: ImportStepAsComponentOpts) {}

  async apply(): Promise<void> {
    const { stepBytes, fileName, kernel, opfs } = this.opts;
    const { setActivePart, setStatus, activeDocument } = useAppStore.getState();

    let partName: string;
    let partPath: string;
    let archiveBytes: Uint8Array;
    let part: PartDocument;

    if (this.redoState) {
      // Redo path: reuse cached bytes, skip STEP re-parse
      const rs = this.redoState;
      partName = rs.partName;
      partPath = rs.partPath;
      archiveBytes = rs.archiveBytes;

      // Rebuild with stable partId so kernel + assembly references stay consistent
      part = buildImportedPartDocument(partName, rs.brepBlobId, rs.fileName, this.placedPartId ?? undefined);
      await kernel.registerPart(part);
      await opfs.write(partPath, archiveBytes);
    } else {
      // First-apply path: full STEP parse pipeline
      const baseName = stepFilenameBasename(fileName);

      // Dedupe against existing OPFS entries
      const existingFiles = await opfs.listAll();
      const existingNames = existingFiles
        .filter((p) => p.endsWith('.zipt'))
        .map((p) => p.replace(/\.zipt$/, '').split('/').pop() ?? '');
      partName = dedupeName(baseName, existingNames);
      partPath = `${partName}.zipt`;

      // Step 1: parse STEP → blob in kernel cache
      const importResult = await kernel.importStep({ stepBytes, partName });

      // Step 2: build PartDocument
      part = buildImportedPartDocument(partName, importResult.brepBlobId, fileName);

      // Step 3: register with kernel
      await kernel.registerPart(part);

      // Step 4: persist to OPFS via kernel.saveToBytes (bakes the ImportedFeature blob)
      archiveBytes = await kernel.saveToBytes(part.id);
      await opfs.write(partPath, archiveBytes);

      // Save state for redo (no second STEP parse needed)
      this.redoState = {
        partName,
        brepBlobId: importResult.brepBlobId,
        fileName,
        partPath,
        archiveBytes,
      };
    }

    this.placedPart = part;
    this.placedPartId = part.id;
    this.placedPartPath = partPath;
    this.placedArchiveBytes = archiveBytes;

    // Step 5: dispatch based on active document kind
    if (activeDocument?.kind === 'assembly') {
      this.wasAssemblyInsert = true;
      const componentId = this.placedId ?? `C${Date.now()}`;
      const instance: ComponentInstance = {
        id: componentId,
        partPath,
        position: { x: 0, y: 0, z: 0 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
      };
      useAppStore.getState().addComponent(instance);
      this.placedId = componentId;
      setStatus(`Imported '${partPath}' and inserted into assembly`);
    } else {
      // Standalone-part path: switch active document to the new part
      this.wasAssemblyInsert = false;
      setActivePart(part);
      setStatus('Imported');
    }
  }

  async revert(): Promise<void> {
    if (!this.placedPartId || !this.placedPartPath) return;
    const { kernel, opfs } = this.opts;

    if (this.wasAssemblyInsert && this.placedId) {
      useAppStore.getState().removeComponent(this.placedId);
      // Keep this.placedId so redo reuses the same component id
    }

    // Evict from OPFS
    try {
      await opfs.delete(this.placedPartPath);
    } catch {
      // Best-effort; file may not exist if apply() failed mid-flight
    }

    // Evict from kernel cache
    try {
      await kernel.deletePart(this.placedPartId);
    } catch {
      // Best-effort
    }

    // Clear current-apply state (redoState preserved for redo)
    this.placedPartId = null;
    this.placedPartPath = null;
  }
}
