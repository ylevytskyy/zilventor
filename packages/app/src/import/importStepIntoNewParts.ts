import type { KernelApi } from '@zilventor/kernel/src/api';
import type { PartDocument } from '@zilventor/shared';
import { buildImportedPartDocument } from './buildImportedPartDocument';
import { dedupeName } from './dedupeName';

type OpfsLike = {
  write: (path: string, data: Uint8Array) => Promise<void>;
  listAll: () => Promise<string[]>;
};

export type ImportStepIntoNewPartsInput = {
  baseName: string;
  sourceFileName: string;
  stepBytes: ArrayBuffer;
  kernel: Pick<KernelApi, 'importStep' | 'splitImportedShape' | 'registerPart' | 'saveToBytes'>;
  opfs: OpfsLike;
};

export type ImportStepIntoNewPartsResult = {
  partId: string;
  opfsPath: string;
  part: PartDocument;
  archiveBytes: Uint8Array;
};

/**
 * 1:N variant of importStepIntoNewPart.
 *
 * Calls kernel.importStep (whole compound) + kernel.splitImportedShape to
 * separate solids from any non-solid surface geometry.
 *
 * Names:
 *   - Solids: N===1 AND no surfaces → bare `${baseName}`
 *             N===1 AND surfaces exist → `${baseName}` (solid), `${baseName}_surfaces`
 *             N>1 → `${baseName}_1` … `${baseName}_N` plus optional `${baseName}_surfaces`
 *   - Surfaces (if non-null): always `${baseName}_surfaces`
 *
 * All names are passed through dedupeName against existing `.zipt` files in OPFS.
 * Does NOT setActiveDocument or addComponent — caller decides.
 *
 * On partial failure mid-loop, rolls back: deletes parts registered so far + opfs entries.
 */
export async function importStepIntoNewParts(
  input: ImportStepIntoNewPartsInput,
): Promise<ImportStepIntoNewPartsResult[]> {
  const { baseName, sourceFileName, stepBytes, kernel, opfs } = input;

  // Import whole compound, then split into solids + optional surfaces bucket
  const whole = await kernel.importStep({ stepBytes, partName: baseName });
  const { solids, surfaces } = await kernel.splitImportedShape(whole.brepBlobId);

  const existing = (await opfs.listAll())
    .filter((p) => p.endsWith('.zipt'))
    .map((p) => p.replace(/\.zipt$/, ''));
  const registered: ImportStepIntoNewPartsResult[] = [];

  // Helper: register one part entry (mutates `registered`)
  async function registerOne(brepBlobId: string, candidateName: string, color?: string): Promise<void> {
    const name = dedupeName(candidateName, [...existing, ...registered.map((r) => r.part.name)]);
    const part = buildImportedPartDocument(name, brepBlobId, sourceFileName, undefined, color);
    await kernel.registerPart(part);
    const archiveBytes = await kernel.saveToBytes(part.id);
    const opfsPath = `${name}.zipt`;
    await opfs.write(opfsPath, archiveBytes);
    registered.push({ partId: part.id, opfsPath, part, archiveBytes });
  }

  try {
    // Register solids
    for (let i = 0; i < solids.length; i++) {
      const solid = solids[i];
      if (!solid) continue;
      // N===1 and no surfaces → bare baseName (original convention for single-body)
      // N===1 and surfaces → still use bare baseName for the solid (surfaces adds _surfaces)
      // N>1 → suffix _1.._N
      const candidateName = solids.length === 1 ? baseName : `${baseName}_${i + 1}`;
      await registerOne(solid.brepBlobId, candidateName, solid.color);
    }

    // Register surfaces bucket if present
    if (surfaces) {
      await registerOne(surfaces.brepBlobId, `${baseName}_surfaces`);
    }

    return registered;
  } catch (err) {
    // Best-effort rollback. `deletePart` on a kernel that may not have the
    // method on a mock degrades to a no-op via optional chaining.
    for (const r of [...registered].reverse()) {
      try {
        await (kernel as Pick<KernelApi, 'importStep' | 'splitImportedShape' | 'registerPart' | 'saveToBytes'> & { deletePart?: (id: string) => Promise<void> }).deletePart?.(r.partId);
      } catch { /* swallow rollback errors */ }
      try {
        await (opfs as OpfsLike & { delete?: (p: string) => Promise<void> }).delete?.(r.opfsPath);
      } catch { /* swallow */ }
    }
    throw err;
  }
}
