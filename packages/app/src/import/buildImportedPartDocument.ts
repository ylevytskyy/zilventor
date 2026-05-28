import type { PartDocument, ImportedFeature } from '@zilventor/shared';
import { ORIGIN_FEATURES } from './originFeatures';

/**
 * Pure: constructs a PartDocument that wraps a pre-imported BREP blob.
 * The blob must already live in the kernel's importedShapeCache (put there
 * by kernel.importStep before this is called).
 *
 * @param partName   Human-readable name (file stem, already deduped).
 * @param brepBlobId The blob ref returned by kernel.importStep.
 * @param fileName   Original STEP filename (stored in ImportedFeature.sourceStep).
 * @param partId     Optional explicit UUID; one is generated if omitted.
 */
export function buildImportedPartDocument(
  partName: string,
  brepBlobId: string,
  fileName: string,
  partId?: string,
): PartDocument {
  const id = partId ?? crypto.randomUUID();
  const importedFeature: ImportedFeature = {
    kind: 'imported',
    id: crypto.randomUUID(),
    sourceStep: fileName,
    bodyRef: brepBlobId,
  };
  return {
    id,
    name: partName,
    units: 'mm',
    parameters: {},
    featureTree: [...ORIGIN_FEATURES, importedFeature],
    properties: {},
    materials: [],
    hardware: [],
  };
}
