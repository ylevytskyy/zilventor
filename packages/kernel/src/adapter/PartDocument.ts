import type { PartDocument, Feature, Parameter, SketchPrimitive } from '@zilventor/shared';

/** Error message prefix for panel placement violations. The full message
 *  carries detail (e.g. "panel must be the first user feature"); tests
 *  match against this constant to check the failure mode. */
export const INVALID_PANEL_PLACEMENT = 'INVALID_PANEL_PLACEMENT' as const;

/**
 * Origin features (work axes/planes/the origin point seeded by `newPart`)
 * sit at the start of the feature tree and are not user-mutable. Anything
 * else is a "user feature" for the purposes of the panel invariant.
 *
 * Detection is by id prefix (`origin.*`) — the seven seeded ids all start
 * with `origin.` and no user-created feature uses that namespace.
 */
function isOriginFeature(f: Feature): boolean {
  return (
    (f.kind === 'workAxis' || f.kind === 'workPlane' || f.kind === 'workPoint') &&
    f.id.startsWith('origin.')
  );
}

/**
 * Enforce the PanelFeature invariant: at most one panel per part, and if
 * present it must be the first user feature (i.e. immediately after the
 * origin features). Throws `Error(INVALID_PANEL_PLACEMENT: ...)` when
 * violated; no-op when the invariant holds. Called by `addFeature` and
 * `removeFeature` so any mutation that breaks the rule fails immediately.
 */
export function validatePanelInvariant(part: PartDocument): void {
  const userFeatures = part.featureTree.filter((f) => !isOriginFeature(f));
  const panels = userFeatures.filter((f) => f.kind === 'panel');
  if (panels.length === 0) return;
  if (panels.length > 1) {
    throw new Error(
      `${INVALID_PANEL_PLACEMENT}: at most one panel per part (found ${panels.length})`,
    );
  }
  if (userFeatures[0]!.kind !== 'panel') {
    throw new Error(`${INVALID_PANEL_PLACEMENT}: panel must be the first user feature`);
  }
}

export function newPart(name: string): PartDocument {
  return {
    id: crypto.randomUUID(),
    name,
    units: 'mm',
    parameters: {},
    properties: {},
    featureTree: [
      { kind: 'workAxis', id: 'origin.X', visible: false, source: { mode: 'origin', axis: 'X' } },
      { kind: 'workAxis', id: 'origin.Y', visible: false, source: { mode: 'origin', axis: 'Y' } },
      { kind: 'workAxis', id: 'origin.Z', visible: false, source: { mode: 'origin', axis: 'Z' } },
      { kind: 'workPlane', id: 'origin.XY', visible: false, source: { mode: 'origin', plane: 'XY' } },
      { kind: 'workPlane', id: 'origin.YZ', visible: false, source: { mode: 'origin', plane: 'YZ' } },
      { kind: 'workPlane', id: 'origin.XZ', visible: false, source: { mode: 'origin', plane: 'XZ' } },
      { kind: 'workPoint', id: 'origin.O', visible: false, source: { mode: 'origin' } },
    ],
    materials: [],
    hardware: [],
  };
}

export function addFeature(part: PartDocument, feature: Feature): PartDocument {
  const next = { ...part, featureTree: [...part.featureTree, feature] };
  validatePanelInvariant(next);
  return next;
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
  const next = { ...part, featureTree: part.featureTree.filter((f) => f.id !== featureId) };
  validatePanelInvariant(next);
  return next;
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
