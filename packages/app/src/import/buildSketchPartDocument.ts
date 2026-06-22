import type { PartDocument, SketchPrimitive, Feature } from '@zilventor/shared';
import { ORIGIN_FEATURES } from './originFeatures';

/**
 * Pure: wraps imported sketch primitives in a single sketch feature on the XY
 * origin plane, returning a PartDocument ready for kernel.registerPart.
 *
 * Mirrors buildImportedPartDocument's shape: 7 ORIGIN_FEATURES + the payload
 * feature, minimal required fields only (exactOptionalPropertyTypes ON).
 */
export function buildSketchPartDocument(name: string, primitives: SketchPrimitive[]): PartDocument {
  const sketch: Feature = {
    kind: 'sketch',
    id: crypto.randomUUID(),
    plane: { source: 'workPlane', featureId: 'origin.XY' },
    primitives,
    constraints: [],
  };
  return {
    id: crypto.randomUUID(),
    name,
    units: 'mm',
    parameters: {},
    featureTree: [...ORIGIN_FEATURES, sketch],
    properties: {},
    materials: [],
    hardware: [],
  };
}
