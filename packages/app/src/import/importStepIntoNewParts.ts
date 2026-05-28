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
  kernel: Pick<KernelApi, 'extractStepSolids' | 'registerPart' | 'saveToBytes'>;
  opfs: OpfsLike;
};

export type ImportStepIntoNewPartsResult = {
  partId: string;
  opfsPath: string;
  part: PartDocument;
  archiveBytes: Uint8Array;
};

/**
 * 1:N variant of importStepIntoNewPart. Calls kernel.extractStepSolids, then
 * for each sub-solid: build → registerPart → saveToBytes → opfs.write.
 *
 * Names: N==1 → `${baseName}` (bare, no suffix); N>1 → `${baseName}_1` … `${baseName}_N`.
 * All names are passed through dedupeName against existing `.zipt` files in OPFS.
 * Does NOT setActiveDocument or addComponent — caller decides.
 *
 * On partial failure mid-loop, rolls back: deletes parts registered so far + opfs entries.
 * (Kernel-side extractStepSolids is atomic — runs once, before any registerPart call.)
 */
export async function importStepIntoNewParts(
  input: ImportStepIntoNewPartsInput,
): Promise<ImportStepIntoNewPartsResult[]> {
  const { baseName, sourceFileName, stepBytes, kernel, opfs } = input;
  const solids = await kernel.extractStepSolids({ stepBytes });

  const existing = (await opfs.listAll())
    .filter((p) => p.endsWith('.zipt'))
    .map((p) => p.replace(/\.zipt$/, ''));
  const registered: ImportStepIntoNewPartsResult[] = [];

  try {
    for (let i = 0; i < solids.length; i++) {
      const candidateName = solids.length === 1 ? baseName : `${baseName}_${i + 1}`;
      const name = dedupeName(candidateName, [...existing, ...registered.map((r) => r.part.name)]);
      const solid = solids[i];
      if (!solid) continue;
      const part = buildImportedPartDocument(name, solid.brepBlobId, sourceFileName);
      await kernel.registerPart(part);
      const archiveBytes = await kernel.saveToBytes(part.id);
      const opfsPath = `${name}.zipt`;
      await opfs.write(opfsPath, archiveBytes);
      registered.push({ partId: part.id, opfsPath, part, archiveBytes });
    }
    return registered;
  } catch (err) {
    // Best-effort rollback. `deletePart` on a kernel that may not have the
    // method on a mock degrades to a no-op via optional chaining.
    for (const r of [...registered].reverse()) {
      try {
        await (kernel as Pick<KernelApi, 'extractStepSolids' | 'registerPart' | 'saveToBytes'> & { deletePart?: (id: string) => Promise<void> }).deletePart?.(r.partId);
      } catch { /* swallow rollback errors */ }
      try {
        await (opfs as OpfsLike & { delete?: (p: string) => Promise<void> }).delete?.(r.opfsPath);
      } catch { /* swallow */ }
    }
    throw err;
  }
}
