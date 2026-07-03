import type { PartDocument, ImportedFeature } from '@zilventor/shared';
import { ORIGIN_FEATURES } from './originFeatures';

/**
 * Pure: constructs a PartDocument that wraps a pre-imported BREP blob.
 * The blob must already live in the kernel's importedShapeCache (put there
 * by kernel.importStep before this is called).
 *
 * @param partName    Human-readable name (file stem, already deduped).
 * @param brepBlobId  The blob ref returned by kernel.importStep.
 * @param fileName    Original STEP filename (stored in ImportedFeature.sourceStep).
 * @param partId      Optional explicit UUID; one is generated if omitted.
 * @param color       Optional first-solid color (#rrggbb) from STEP XCAF data.
 * @param solidColors Optional full per-solid color array (index-aligned with
 *                    TopExp_Explorer SOLID order). Persisted on the feature so
 *                    colors survive save→reload without the in-memory cache.
 * @param isManifold  Optional closed-manifold/valid-topology flag computed by
 *                    the kernel for the exact shape this feature's bodyRef
 *                    points at. Gated on `!== undefined`, not truthiness —
 *                    `false` is a meaningful value that must not be dropped.
 */
export function buildImportedPartDocument(
  partName: string,
  brepBlobId: string,
  fileName: string,
  partId?: string,
  color?: string,
  solidColors?: (string | null)[],
  isManifold?: boolean,
): PartDocument {
  const id = partId ?? crypto.randomUUID();
  const importedFeature: ImportedFeature = {
    kind: 'imported',
    id: crypto.randomUUID(),
    sourceStep: fileName,
    bodyRef: brepBlobId,
    ...(color ? { color } : {}),
    ...(solidColors ? { solidColors } : {}),
    ...(isManifold !== undefined ? { isManifold } : {}),
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
    ...(color ? { color: { kind: 'hex', hex: color } as const } : {}),
  };
}
