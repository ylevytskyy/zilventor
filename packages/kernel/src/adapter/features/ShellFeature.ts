import type { OcctInstance } from '../../occt/occtLoader';
import {
  type NamedShape,
  faceNamesEqual,
  attachName,
  namedFace
} from '../../occt/FaceNaming';
import { makeShell } from '../../occt/ShellOps';
import {
  ok,
  err,
  type Result,
  type KernelError,
  newCorrelationId,
  type ShellFeature,
  type ParamOrLiteral
} from '@zilventor/shared';

/**
 * Run a shell feature against a running body.
 *
 * Flow:
 *   1. Resolve each `FaceName` in `feature.facesToRemove` to its
 *      `TopoDS_Face` via a lookup on `runningBody.faceNames`. A missing
 *      name is a hard error for the feature (soft-fails upstream in
 *      `FeatureTree`).
 *   2. Resolve `feature.thickness` via `resolveParam`.
 *   3. Call `makeShell`.
 *   4. Name faces of the result: surviving input faces (`IsSame`) keep
 *      their name; new internal shell faces get `{feature.id}/shell/{n}`.
 */
export function executeShellFeature(
  oc: OcctInstance,
  runningBody: NamedShape,
  feature: ShellFeature,
  resolveParam: (p: ParamOrLiteral) => Result<number, KernelError>
): Result<NamedShape, KernelError> {
  const facesToRemove: unknown[] = [];
  for (const name of feature.facesToRemove) {
    const entry = runningBody.faceNames.find((f) => faceNamesEqual(f.name, name));
    if (!entry) {
      return err({
        kind: 'edgeNotFound',
        message: `Shell: face ${name.featureId}/${name.role}/${name.instance ?? 0} not found in running body`,
        correlationId: newCorrelationId(),
        featureId: feature.id
      });
    }
    facesToRemove.push(entry.face);
  }

  const t = resolveParam(feature.thickness);
  if (!t.ok) return err({ ...t.error, featureId: feature.id });

  const result = makeShell(oc, runningBody.shape, {
    facesToRemove,
    thickness: t.value
  });
  if (!result.ok) return err({ ...result.error, featureId: feature.id });

  const named: NamedShape = { shape: result.value, faceNames: [] };
  const map = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(
    result.value.handle as never,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    map as never
  );
  let shellIndex = 0;
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
      attachName(named, face, namedFace(feature.id, 'shell', shellIndex++));
    }
  }
  map.delete();
  return ok(named);
}
