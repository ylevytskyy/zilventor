import type { PartDocument, Feature, Parameter, SketchPrimitive } from '@zilventor/shared';

export function newPart(name: string): PartDocument {
  return {
    id: crypto.randomUUID(),
    name,
    units: 'mm',
    parameters: {},
    featureTree: [
      { kind: 'workAxis', id: 'origin.X', visible: false, source: { mode: 'origin', axis: 'X' } },
      { kind: 'workAxis', id: 'origin.Y', visible: false, source: { mode: 'origin', axis: 'Y' } },
      { kind: 'workAxis', id: 'origin.Z', visible: false, source: { mode: 'origin', axis: 'Z' } },
      { kind: 'workPlane', id: 'origin.XY', visible: false, source: { mode: 'origin', plane: 'XY' } },
      { kind: 'workPlane', id: 'origin.YZ', visible: false, source: { mode: 'origin', plane: 'YZ' } },
      { kind: 'workPlane', id: 'origin.XZ', visible: false, source: { mode: 'origin', plane: 'XZ' } },
      { kind: 'workPoint', id: 'origin.O', visible: false, source: { mode: 'origin' } },
    ]
  };
}

export function addFeature(part: PartDocument, feature: Feature): PartDocument {
  return { ...part, featureTree: [...part.featureTree, feature] };
}

export function setParameter(part: PartDocument, param: Parameter): PartDocument {
  return { ...part, parameters: { ...part.parameters, [param.name]: param } };
}

export function removeParameter(part: PartDocument, name: string): PartDocument {
  const { [name]: _removed, ...rest } = part.parameters;
  void _removed;
  return { ...part, parameters: rest };
}

export function removeFeature(part: PartDocument, featureId: string): PartDocument {
  return { ...part, featureTree: part.featureTree.filter((f) => f.id !== featureId) };
}

export function addPrimitive(part: PartDocument, sketchId: string, primitive: SketchPrimitive): PartDocument {
  const idx = part.featureTree.findIndex((f) => f.kind === 'sketch' && f.id === sketchId);
  if (idx < 0) throw new Error(`no sketch ${sketchId}`);
  const sketch = part.featureTree[idx]! as Extract<Feature, { kind: 'sketch' }>;
  const nextSketch: Extract<Feature, { kind: 'sketch' }> = { ...sketch, primitives: [...sketch.primitives, primitive] };
  const nextTree = [...part.featureTree];
  nextTree[idx] = nextSketch;
  return { ...part, featureTree: nextTree };
}

export function removePrimitive(part: PartDocument, sketchId: string, primitiveId: string): PartDocument {
  const idx = part.featureTree.findIndex((f) => f.kind === 'sketch' && f.id === sketchId);
  if (idx < 0) throw new Error(`no sketch ${sketchId}`);
  const sketch = part.featureTree[idx]! as Extract<Feature, { kind: 'sketch' }>;
  const nextPrimitives = sketch.primitives.filter((p) => p.id !== primitiveId);
  const nextSketch: Extract<Feature, { kind: 'sketch' }> = { ...sketch, primitives: nextPrimitives };
  const nextTree = [...part.featureTree];
  nextTree[idx] = nextSketch;
  return { ...part, featureTree: nextTree };
}
