import type { Command } from './Command';
import type { KernelApi } from '@zilventor/kernel/src/api';
import type { ComponentColor, ComponentInstance, PartDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { buildImportedPartDocument } from '../import/buildImportedPartDocument';
import { stepFilenameBasename } from '../import/originFeatures';
import { importStepIntoNewParts } from '../import/importStepIntoNewParts';

export type OpfsLike = {
  write(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  listAll(): Promise<string[]>;
};

export type ImportStepAsComponentOpts = {
  stepBytes: ArrayBuffer;
  fileName: string;
  kernel: Pick<KernelApi, 'importStep' | 'splitImportedShape' | 'registerPart' | 'deletePart' | 'saveToBytes'>;
  opfs: OpfsLike;
};

/**
 * Atomic command: import a STEP file and (when an assembly is active)
 * insert it as N new components at the assembly origin (one per sub-solid).
 *
 * Multi-body STEPs become N PartDocuments + N ComponentInstances at origin.
 * Single-body case (N=1) reduces cleanly to one component — unchanged behaviour.
 *
 * When no assembly is active (part- or drawing-active), behaves like
 * importStepIntoNewPart: creates a standalone top-level part (first solid only)
 * and switches the active document to it.
 *
 * Undo: removes all N components + evicts all N parts from OPFS + kernel cache.
 * Redo: re-registers from in-memory bytes + re-persists + re-inserts (skips
 *       importStep+splitImportedShape — relies on deletePart NOT evicting importedShapeCache).
 */
export class ImportStepAsComponentCommand implements Command {
  readonly name = 'ImportStepAsComponent';

  // Captured during apply() for undo/redo — arrays for multi-body
  private placedIds: string[] = [];         // componentInstance IDs
  private placedPartIds: string[] = [];
  private placedPartPaths: string[] = [];
  private placedParts: PartDocument[] = [];
  private placedArchiveBytes: Uint8Array[] = [];

  /** Whether apply() ran the assembly path (true) or standalone-part path (false). */
  private wasAssemblyInsert = false;

  /** Saved state for redo: avoids re-calling importStep+splitImportedShape (blobs stay in cache). */
  private redoState: Array<{
    partName: string;
    brepBlobId: string;
    fileName: string;
    partPath: string;
    archiveBytes: Uint8Array;
    /** Per-body STEP color (#rrggbb), preserved so redo re-stamps it. */
    color?: string;
  }> | null = null;

  constructor(private readonly input: ImportStepAsComponentOpts) {}

  async apply(): Promise<void> {
    const { stepBytes, fileName, kernel, opfs } = this.input;
    const { activeDocument } = useAppStore.getState();
    this.wasAssemblyInsert = activeDocument?.kind === 'assembly';

    // ---- Redo-optimized path: re-register cached parts + re-add components ----
    if (this.redoState) {
      // Reset placed arrays (they were cleared in revert)
      this.placedPartIds = [];
      this.placedPartPaths = [];
      this.placedParts = [];
      this.placedArchiveBytes = [];
      this.placedIds = [];

      for (const r of this.redoState) {
        // Rebuild with stable partId if we had one before
        const part = buildImportedPartDocument(r.partName, r.brepBlobId, r.fileName, undefined, r.color);
        await kernel.registerPart(part);
        await opfs.write(r.partPath, r.archiveBytes);
        this.placedPartIds.push(part.id);
        this.placedPartPaths.push(r.partPath);
        this.placedParts.push(part);
        this.placedArchiveBytes.push(r.archiveBytes);
      }

      if (this.wasAssemblyInsert) {
        for (let i = 0; i < this.placedPartPaths.length; i++) {
          const partPath = this.placedPartPaths[i]!;
          const part = this.placedParts[i];
          const instance = makeOriginInstance(partPath, part?.color);
          useAppStore.getState().addComponent(instance);
          this.placedIds.push(instance.id);
        }
      } else if (this.placedParts[0]) {
        useAppStore.getState().setActivePart(this.placedParts[0]);
      }
      return;
    }

    // ---- Fresh apply: call importStepIntoNewParts ----
    const results = await importStepIntoNewParts({
      baseName: stepFilenameBasename(fileName),
      sourceFileName: fileName,
      stepBytes,
      kernel,
      opfs,
    });

    for (const r of results) {
      this.placedPartIds.push(r.partId);
      this.placedPartPaths.push(r.opfsPath);
      this.placedParts.push(r.part);
      this.placedArchiveBytes.push(r.archiveBytes);
    }

    if (this.wasAssemblyInsert) {
      for (let i = 0; i < this.placedPartPaths.length; i++) {
        const partPath = this.placedPartPaths[i]!;
        const part = this.placedParts[i];
        const instance = makeOriginInstance(partPath, part?.color);
        useAppStore.getState().addComponent(instance);
        this.placedIds.push(instance.id);
      }
      useAppStore.getState().setStatus(
        results.length === 1
          ? `Imported ${results[0]?.part.name ?? fileName}`
          : `Imported ${results.length} bodies from ${fileName}`,
      );
    } else {
      // Part-mode: register first part as active document
      if (results[0]) {
        useAppStore.getState().setActivePart(results[0].part);
        if (results.length > 1) {
          useAppStore.getState().setStatus(
            `Imported first body of ${results.length} from ${fileName}`,
          );
        } else {
          useAppStore.getState().setStatus('Imported');
        }
      }
    }
  }

  async revert(): Promise<void> {
    const { kernel, opfs } = this.input;

    // Remove components first (reverse order for cleanliness)
    for (const id of [...this.placedIds].reverse()) {
      useAppStore.getState().removeComponent(id);
    }

    // Capture redo state BEFORE deleting parts (blob IDs still valid in kernel cache)
    this.redoState = this.placedParts.map((part, i) => ({
      partName: part.name,
      brepBlobId: extractBrepBlobIdFromPart(part),
      fileName: this.input.fileName,
      partPath: this.placedPartPaths[i] ?? '',
      archiveBytes: this.placedArchiveBytes[i] ?? new Uint8Array(0),
      ...(part.color?.kind === 'hex' ? { color: part.color.hex } : {}),
    }));

    // Delete all registered parts from kernel (does NOT evict importedShapeCache)
    for (const partId of this.placedPartIds) {
      try {
        await kernel.deletePart(partId);
      } catch {
        // best-effort
      }
    }

    // Delete OPFS files (best-effort)
    for (const path of this.placedPartPaths) {
      try {
        await opfs.delete(path);
      } catch {
        // best-effort
      }
    }

    // Clear placed arrays so redo flows through the redoState path
    this.placedIds = [];
    this.placedPartIds = [];
    this.placedPartPaths = [];
    this.placedParts = [];
    this.placedArchiveBytes = [];
  }
}

// ---------- helpers ----------------------------------------------------------

function makeOriginInstance(partPath: string, color?: ComponentColor): ComponentInstance {
  return {
    id: `comp-${crypto.randomUUID()}`,
    partPath,
    position: { x: 0, y: 0, z: 0 },
    rotation: { rx: 0, ry: 0, rz: 0 },
    visible: true,
    ...(color ? { color } : {}),
  };
}

function extractBrepBlobIdFromPart(part: PartDocument): string {
  const imported = part.featureTree.find((f) => f.kind === 'imported');
  if (!imported || imported.kind !== 'imported') {
    throw new Error('ImportStepAsComponent: missing imported feature in revert state');
  }
  return imported.bodyRef;
}
