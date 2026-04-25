import type { OcctInstance } from '../../occt/occtLoader';
import type { Feature, SweepFeature, SweepOrientation } from '@zilventor/shared';
import { type NamedShape } from '../../occt/FaceNaming';
import {
  buildWireFromSketch,
  makeSweep,
  type ResolvedSweepOrientation,
} from '../../occt/SweepOps';
import { fuseShapes, cutShapes } from '../../occt/BooleanOps';

function getSketch(sketchById: Map<string, Feature>, id: string, role: string): Extract<Feature, { kind: 'sketch' }> {
  const s = sketchById.get(id);
  if (!s || s.kind !== 'sketch') throw new Error(`sweep: ${role} sketch ${id} not found`);
  return s as Extract<Feature, { kind: 'sketch' }>;
}

function resolveOrientation(
  oc: OcctInstance,
  sketchById: Map<string, Feature>,
  o: SweepOrientation,
): ResolvedSweepOrientation {
  if (o.kind === 'path') return { kind: 'path' };
  if (o.kind === 'parallel') return { kind: 'parallel' };
  const guideSketch = getSketch(sketchById, o.guideRailSketchId, 'guide rail');
  const guideWire = buildWireFromSketch(oc as any, guideSketch);
  return { kind: 'guideRail', guideWire };
}

/**
 * Execute a sweep feature against a running body.
 * - operation 'new': returns the swept solid as the new running body. runningBody may be null.
 * - operation 'join'/'cut': implemented in Task 11; throws here for now.
 *
 * Caller (FeatureTree) wraps in try/catch for soft-fail.
 */
export function executeSweepFeature(
  oc: OcctInstance,
  runningBody: NamedShape | null,
  feature: SweepFeature,
  sketchById: Map<string, Feature>,
): NamedShape {
  const profileSketch = getSketch(sketchById, feature.profileSketchId, 'profile');
  const pathSketch = getSketch(sketchById, feature.pathSketchId, 'path');

  const profileWire = buildWireFromSketch(oc as any, profileSketch);
  const pathWire = buildWireFromSketch(oc as any, pathSketch);
  const orientation = resolveOrientation(oc, sketchById, feature.orientation);

  const sweptSolid = makeSweep(oc as any, profileWire, pathWire, orientation);

  const sweptOcct = { __brand: 'OcctShape' as const, handle: sweptSolid };

  let resultShape: any;
  if (feature.operation === 'new' || runningBody === null) {
    resultShape = sweptSolid;
  } else if (feature.operation === 'join') {
    const bodyOcct = { __brand: 'OcctShape' as const, handle: runningBody.shape };
    const r = fuseShapes(oc, bodyOcct, sweptOcct);
    if (!r.ok) throw new Error(`sweep: fuseShapes failed: ${JSON.stringify(r.error)}`);
    resultShape = r.value.handle;
  } else {
    // 'cut'
    const bodyOcct = { __brand: 'OcctShape' as const, handle: runningBody.shape };
    const r = cutShapes(oc, bodyOcct, sweptOcct);
    if (!r.ok) throw new Error(`sweep: cutShapes failed: ${JSON.stringify(r.error)}`);
    resultShape = r.value.handle;
  }

  // Face naming wired in Task 12. Empty for now.
  const named: NamedShape = { shape: resultShape, faceNames: [] };
  return named;
}
