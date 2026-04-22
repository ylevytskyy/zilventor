import type { PartDocument, Feature, Parameter } from '@zilventor/shared';

export function newPart(name: string): PartDocument {
  return {
    id: crypto.randomUUID(),
    name,
    units: 'mm',
    parameters: {},
    featureTree: []
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
