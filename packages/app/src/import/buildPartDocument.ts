import type { PartDocument, ImportedFeature, SketchParameter, Feature } from '@zilventor/shared';
import type { ImporterPartJson, ImporterParameter } from './inventorJsonSchema';

const ORIGIN_FEATURES: Feature[] = [
  { kind: 'workAxis', id: 'origin.X', visible: false, source: { mode: 'origin', axis: 'X' } },
  { kind: 'workAxis', id: 'origin.Y', visible: false, source: { mode: 'origin', axis: 'Y' } },
  { kind: 'workAxis', id: 'origin.Z', visible: false, source: { mode: 'origin', axis: 'Z' } },
  { kind: 'workPlane', id: 'origin.XY', visible: false, source: { mode: 'origin', plane: 'XY' } },
  { kind: 'workPlane', id: 'origin.YZ', visible: false, source: { mode: 'origin', plane: 'YZ' } },
  { kind: 'workPlane', id: 'origin.XZ', visible: false, source: { mode: 'origin', plane: 'XZ' } },
  { kind: 'workPoint', id: 'origin.O', visible: false, source: { mode: 'origin' } },
];

export type BuildPartArgs = {
  partJson: ImporterPartJson;
  importResult: { brepBlobId: string; triangleCount: number; boundingBox: readonly [number, number, number, number, number, number]; faceCount: number };
  partId: string;
  importedFeatureId: string;
};

function stepFilenameBasename(stepRef: string): string {
  const base = stepRef.split('/').pop() ?? stepRef;
  return base.replace(/\.step$/i, '');
}

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
  };
}
