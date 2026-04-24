import type { OcctInstance } from '../../occt/occtLoader';
import {
  type NamedShape,
  attachName,
  tagHoleFaces,
} from '../../occt/FaceNaming';
import {
  makeHole,
  type HoleLocation,
  type ResolvedHoleProfile,
  type ResolvedHoleTermination,
} from '../../occt/HoleOps';
import type {
  Feature,
  HoleFeature,
  HoleProfile,
  HoleTermination,
  ParamOrLiteral,
} from '@zilventor/shared';

type Vec3 = { x: number; y: number; z: number };

function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}
function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function neg(v: Vec3): Vec3 {
  return { x: -v.x, y: -v.y, z: -v.z };
}

function sketchPlaneFrame(plane: 'XY' | 'XZ' | 'YZ'): { u: Vec3; v: Vec3; n: Vec3 } {
  if (plane === 'XY') return { u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 1, z: 0 }, n: { x: 0, y: 0, z: 1 } };
  if (plane === 'XZ') return { u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 0, z: 1 }, n: { x: 0, y: 1, z: 0 } };
  return { u: { x: 0, y: 1, z: 0 }, v: { x: 0, y: 0, z: 1 }, n: { x: 1, y: 0, z: 0 } };
}

function resolveProfile(p: HoleProfile, resolve: (v: ParamOrLiteral) => number): ResolvedHoleProfile {
  if (p.kind === 'simple') return { kind: 'simple', diameter: resolve(p.diameter) };
  if (p.kind === 'counterbore') return {
    kind: 'counterbore',
    diameter: resolve(p.diameter),
    cboreDiameter: resolve(p.cboreDiameter),
    cboreDepth: resolve(p.cboreDepth),
  };
  return {
    kind: 'countersink',
    diameter: resolve(p.diameter),
    cskDiameter: resolve(p.cskDiameter),
    cskAngleDeg: resolve(p.cskAngle),
  };
}

function resolveTermination(
  t: HoleTermination,
  resolve: (v: ParamOrLiteral) => number,
): ResolvedHoleTermination | null {
  if (t.kind === 'distance') return { kind: 'distance', depth: resolve(t.depth), blindTip: true };
  if (t.kind === 'throughAll') return { kind: 'throughAll' };
  if (t.kind === 'toNext') return { kind: 'toNext' };
  return null;  // toFace — implemented in Task 14
}

function resolveFromSketchLocations(
  oc: OcctInstance,
  sketch: Extract<Feature, { kind: 'sketch' }>,
  flipAxis: boolean,
): HoleLocation[] {
  const frame = sketchPlaneFrame(sketch.plane as 'XY' | 'XZ' | 'YZ');
  const axisVec = flipAxis ? neg(frame.n) : frame.n;
  const locations: HoleLocation[] = [];
  for (const prim of sketch.primitives) {
    if ((prim as { kind: string }).kind !== 'circle') continue;
    const c = prim as unknown as { cx: number; cy: number };
    const p3 = add(scale(frame.u, c.cx), scale(frame.v, c.cy));
    const origin = new (oc as any).gp_Pnt_3(p3.x, p3.y, p3.z);
    const axis = new (oc as any).gp_Dir_4(axisVec.x, axisVec.y, axisVec.z);
    locations.push({ origin, axis });
  }
  return locations;
}

/**
 * Execute a hole feature against a running body.
 *
 * Task 10 scope: fromSketch placement + simple/cbore/csk profiles + distance/throughAll/toNext
 * terminations. linear (Task 12), concentric (Task 13), and toFace (Task 14) throw.
 *
 * Caller (FeatureTree.executeTree, Task 17) wraps in try/catch for soft-fail.
 */
export function executeHoleFeature(
  oc: OcctInstance,
  runningBody: NamedShape,
  feature: HoleFeature,
  resolveParam: (p: ParamOrLiteral) => number,
  sketchById: Map<string, Feature>,
): NamedShape {
  let locations: HoleLocation[];
  if (feature.placement.kind === 'fromSketch') {
    const sketch = sketchById.get(feature.placement.sketchId);
    if (!sketch || sketch.kind !== 'sketch') {
      throw new Error(`hole: sketch ${feature.placement.sketchId} not found`);
    }
    locations = resolveFromSketchLocations(oc, sketch, feature.flipAxis);
  } else {
    throw new Error(`hole: placement ${(feature.placement as { kind: string }).kind} not implemented in Task 10`);
  }

  const profile = resolveProfile(feature.profile, resolveParam);
  const termination = resolveTermination(feature.termination, resolveParam);
  if (termination === null) throw new Error('hole: toFace termination not yet implemented');

  const cutShape = makeHole(oc as any, runningBody.shape as any, locations, profile, termination);

  const blind = termination.kind === 'distance';
  const newNames = tagHoleFaces(oc, cutShape, feature.id, 0, feature.profile.kind, blind);

  const named: NamedShape = { shape: cutShape as any, faceNames: [...runningBody.faceNames] };
  for (const [face, name] of newNames) {
    attachName(named, face, name);
  }
  return named;
}
