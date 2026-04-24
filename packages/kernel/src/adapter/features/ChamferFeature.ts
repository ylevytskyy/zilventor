import type { OcctInstance } from '../../occt/occtLoader';
import {
  type NamedShape,
  resolveEdge,
  attachName,
  namedFace
} from '../../occt/FaceNaming';
import { makeChamfer, type ChamferRequest } from '../../occt/ChamferOps';
import {
  ok,
  err,
  type Result,
  type KernelError,
  newCorrelationId,
  type ChamferFeature,
  type ParamOrLiteral
} from '@zilventor/shared';

/**
 * Run a chamfer feature against a running body. Mirrors
 * `executeFilletFeature` structurally, with:
 *   - `distance` instead of `radius`
 *   - no variable/setback modes (MVP uses symmetric `Add_2` only)
 *   - surviving-face names carry over identically; new blend faces are
 *     named `{feature.id}/blend/{n}` (same scheme as fillet).
 */
export function executeChamferFeature(
  oc: OcctInstance,
  runningBody: NamedShape,
  feature: ChamferFeature,
  resolveParam: (p: ParamOrLiteral) => Result<number, KernelError>
): Result<NamedShape, KernelError> {
  const chamferEdges: ChamferRequest['edges'] = [];
  for (const spec of feature.edges) {
    const rawEdge = resolveEdge(oc, runningBody, spec.edgeId);
    if (!rawEdge) {
      return err({
        kind: 'edgeNotFound',
        message: `Edge ${spec.edgeId.faceA.role}-${spec.edgeId.faceB.role} not found in running body`,
        correlationId: newCorrelationId(),
        featureId: feature.id
      });
    }
    const edge = (oc.TopoDS as { Edge_1: (s: unknown) => unknown }).Edge_1(
      rawEdge as never
    );
    const d = resolveParam(spec.distance);
    if (!d.ok) return err({ ...d.error, featureId: feature.id });
    chamferEdges.push({ edge, distance: d.value });
  }

  const result = makeChamfer(oc, runningBody.shape, { edges: chamferEdges });
  if (!result.ok) return err({ ...result.error, featureId: feature.id });

  const named: NamedShape = { shape: result.value, faceNames: [] };
  const map = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(
    result.value.handle as never,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    map as never
  );
  let blendIndex = 0;
  const extent = (map as { Extent: () => number }).Extent();
  for (let i = 1; i <= extent; i++) {
    const faceShape = (map as { FindKey: (i: number) => unknown }).FindKey(i);
    const face = (oc.TopoDS as { Face_1: (s: unknown) => unknown }).Face_1(
      faceShape as never
    );
    const surviving = runningBody.faceNames.find((f) =>
      (face as { IsSame?: (o: unknown) => boolean }).IsSame?.(f.face as never)
    );
    if (surviving) {
      attachName(named, face, surviving.name);
    } else {
      attachName(named, face, namedFace(feature.id, 'blend', blendIndex++));
    }
  }
  map.delete();
  return ok(named);
}
