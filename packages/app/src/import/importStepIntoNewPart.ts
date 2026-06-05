import type { KernelApi } from '@zilventor/kernel/src/api';
import type { PartDocument } from '@zilventor/shared';
import { stepFilenameBasename } from './originFeatures';
import { buildImportedPartDocument } from './buildImportedPartDocument';

/**
 * Imports a stand-alone STEP file as a new PartDocument and registers it
 * with the kernel. The returned part is ready to be passed to
 * `setActivePart` so the viewport will render it.
 *
 * Reuses the same ImportedFeature pipeline that Sub-project 1.5 (Inventor
 * importer) introduced: kernel.importStep caches the brep blob, and the
 * ImportedFeature evaluator pulls it back during execute().
 */
export async function importStepIntoNewPart(
  file: File,
  kernel: KernelApi,
): Promise<{ partId: string; part: PartDocument }> {
  const stepBytes = await file.arrayBuffer();
  const partName = stepFilenameBasename(file.name);

  const importResult = await kernel.importStep({ stepBytes, partName });

  // Use the first solid's XCAF color as the part's default render color.
  // For single-body files this is the only color; for multi-body whole-compound
  // opens the first enumerated solid wins (consistent with the viewer bias
  // toward showing "something" rather than no color at all). undefined → gray.
  const firstSolidColor = importResult.solidColors?.find((c) => c !== null) ?? undefined;

  const part = buildImportedPartDocument(partName, importResult.brepBlobId, file.name, undefined, firstSolidColor);

  await kernel.registerPart(part);
  return { partId: part.id, part };
}
