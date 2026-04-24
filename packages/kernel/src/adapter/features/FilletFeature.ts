import type { OcctInstance } from '../../occt/occtLoader';
import {
  type NamedShape,
  resolveEdge,
  resolveVertex,
  attachName,
  namedFace
} from '../../occt/FaceNaming';
import { makeFillet, type FilletRequest } from '../../occt/FilletOps';
import {
  ok,
  err,
  type Result,
  type KernelError,
  newCorrelationId,
  type FilletFeature,
  type ParamOrLiteral
} from '@zilventor/shared';

/**
 * Run a fillet feature against a running body.
 *
 * Flow:
 *   1. Resolve each FilletEdgeSpec.edgeId to a TopoDS_Edge via resolveEdge.
 *      A null means an upstream parametric edit invalidated the feature —
 *      return edgeNotFound with the offending edge identity in the message.
 *   2. Resolve every radius / startR / endR / setback via resolveParam.
 *   3. Build FilletRequest; call makeFillet.
 *   4. Name the result's faces: surviving input faces (TopoDS IsSame to any
 *      input face) keep their names; newly-created blend faces get
 *      {feature.id}/blend/{n}.
 *   5. Return NamedShape.
 *
 * Enumeration pattern: use `TopExp.MapShapes_1 + TopTools_IndexedMapOfShape_1`
 * for unique face enumeration (avoids per-owner double-counts across shared
 * faces). Downcast each unique shape to `TopoDS_Face` via `TopoDS.Face_1`.
 *
 * Memory discipline:
 *   - The `TopTools_IndexedMapOfShape_1` scratch handle is disposed after
 *     enumeration.
 *   - Returned TopoDS_Face handles are OWNED by the NamedShape (passed to
 *     `attachName`) and must not be disposed by the caller until the shape
 *     itself is disposed.
 *   - Setback vertex/edge handles from `resolveVertex`/`resolveEdge` are tied
 *     to the input shape and not disposed here.
 */
export function executeFilletFeature(
  oc: OcctInstance,
  runningBody: NamedShape,
  feature: FilletFeature,
  resolveParam: (p: ParamOrLiteral) => Result<number, KernelError>
): Result<NamedShape, KernelError> {
  // resolveEdge/resolveVertex yield raw `TopoDS_Shape` handles (from
  // `TopExp_Explorer.Current()`); `BRepFilletAPI_MakeFillet.Add_2` — and the
  // setback/variable-radius overloads — require concrete `TopoDS_Edge` /
  // `TopoDS_Vertex`. Downcast via `TopoDS.Edge_1` / `TopoDS.Vertex_1` here
  // so every handle handed to `makeFillet` carries the right runtime type.
  const filletEdges: FilletRequest['edges'] = [];
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
    if (feature.mode === 'variable' && spec.variableRadii) {
      const startR = resolveParam(spec.variableRadii.startRadius);
      if (!startR.ok) return err({ ...startR.error, featureId: feature.id });
      const endR = resolveParam(spec.variableRadii.endRadius);
      if (!endR.ok) return err({ ...endR.error, featureId: feature.id });
      filletEdges.push({
        edge,
        radius: 0,
        variable: { startRadius: startR.value, endRadius: endR.value }
      });
    } else {
      const r = resolveParam(spec.radius);
      if (!r.ok) return err({ ...r.error, featureId: feature.id });
      filletEdges.push({ edge, radius: r.value });
    }
  }

  const setbacks: FilletRequest['setbacks'] = [];
  for (const sb of feature.setbacks) {
    const rawVertex = resolveVertex(oc, runningBody, sb.vertexId);
    if (!rawVertex) continue;
    const vertex = (oc.TopoDS as { Vertex_1: (s: unknown) => unknown }).Vertex_1(
      rawVertex as never
    );
    for (const pe of sb.perEdgeSetbacks) {
      const rawEdge = resolveEdge(oc, runningBody, pe.edgeId);
      if (!rawEdge) continue;
      const edge = (oc.TopoDS as { Edge_1: (s: unknown) => unknown }).Edge_1(
        rawEdge as never
      );
      const val = resolveParam(pe.setback);
      if (!val.ok) return err({ ...val.error, featureId: feature.id });
      setbacks.push({ vertex, edge, setback: val.value });
    }
  }

  const result = makeFillet(oc, runningBody.shape, {
    edges: filletEdges,
    setbacks
  });
  if (!result.ok) return err({ ...result.error, featureId: feature.id });

  // Name faces of the result. Surviving input faces (TopoDS IsSame to an
  // input face) keep their name; new faces get feature.id/blend/n.
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
