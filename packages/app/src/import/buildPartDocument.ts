import type { PartDocument, ImportedFeature, SketchParameter } from '@zilventor/shared';
import type { ImporterPartJson, ImporterParameter } from './inventorJsonSchema';
import { ORIGIN_FEATURES, stepFilenameBasename } from './originFeatures';

export type BuildPartArgs = {
  partJson: ImporterPartJson;
  importResult: { brepBlobId: string; triangleCount: number; boundingBox: readonly [number, number, number, number, number, number]; faceCount: number };
  partId: string;
  importedFeatureId: string;
};

function toSketchParameter(name: string, p: ImporterParameter): SketchParameter {
  switch (p.unit) {
    case 'mm':
      return { name, expression: p.expression, unit: 'mm', value: p.value };
    case 'deg':
      return { name, expression: p.expression, unit: 'deg', value: p.value };
    case 'rad':
      return {
        name,
        expression: `${p.expression} /* converted from rad */`,
        unit: 'deg',
        value: p.value * (180 / Math.PI),
      };
    case 'unitless':
      return { name, expression: p.expression, unit: 'mm', value: p.value };
  }
}

export function buildPartDocument(args: BuildPartArgs): PartDocument {
  const { partJson, importResult, partId, importedFeatureId } = args;
  const importedFeature: ImportedFeature = {
    kind: 'imported',
    id: importedFeatureId,
    sourceStep: partJson.step,
    bodyRef: importResult.brepBlobId,
  };
  const parameters: Record<string, SketchParameter> = {};
  for (const [k, v] of Object.entries(partJson.parameters)) {
    parameters[k] = toSketchParameter(k, v);
  }
  const name = partJson.name && partJson.name.length > 0 ? partJson.name : stepFilenameBasename(partJson.step);
  return {
    id: partId,
    name,
    units: 'mm',
    parameters,
    featureTree: [...ORIGIN_FEATURES, importedFeature],
    properties: { ...partJson.properties },
    materials: [],
    hardware: [],
  };
}
