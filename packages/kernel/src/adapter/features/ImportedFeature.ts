import type { OcctInstance } from '../../occt/occtLoader';
import type { ImportedFeature, FaceName } from '@zilventor/shared';
import type { OcctShape } from '../../occt/SolidOps';
import { type NamedShape, attachName } from '../../occt/FaceNaming';

/**
 * Evaluate an imported feature.
 *
 * The kernel keeps a long-lived `importedShapeCache` (see api.ts) keyed by
 * `bodyRef`. We must NOT hand the cached shape directly to the caller —
 * `executeTree`'s NamedShape cache disposes the previous shape on the next
 * `execute()`, which would free our cached brep. Instead we copy the brep
 * via `BRepBuilderAPI_Copy_*` and tag the copy's faces with deterministic
 * names of the form `{featureId, role: 'imported-face', instance: <occt-idx>}`.
 *
 * Caller (`executeTree`) owns the returned `NamedShape.shape` and disposes it
 * via `disposeShape` like any other feature output.
 */
export function executeImportedFeature(
  oc: OcctInstance,
  feature: ImportedFeature,
  lookup: (bodyRef: string) => OcctShape | undefined,
): NamedShape {
  const cached = lookup(feature.bodyRef);
  if (!cached) {
    throw new Error(
      `ImportedFeature "${feature.id}": no brep cached for bodyRef "${feature.bodyRef}"`,
    );
  }

  // Probe for a Copy constructor — the codebase has not used this binding
  // before, so the exact suffix may vary across opencascade.js versions.
  type CopyInst = { Shape(): unknown; delete?(): void };
  const ocAny = oc as unknown as Record<string, unknown>;
  const Copy2 = ocAny.BRepBuilderAPI_Copy_2 as
    | (new (s: unknown, copyGeom: boolean, copyMesh: boolean) => CopyInst)
    | undefined;
  const Copy1 = ocAny.BRepBuilderAPI_Copy_1 as
    | (new (s: unknown, copyGeom: boolean) => CopyInst)
    | undefined;
  const Copy0 = ocAny.BRepBuilderAPI_Copy as
    | (new (s: unknown) => CopyInst)
    | undefined;

  let copier: CopyInst;
  if (Copy2) copier = new Copy2(cached.handle, true, false);
  else if (Copy1) copier = new Copy1(cached.handle, true);
  else if (Copy0) copier = new Copy0(cached.handle);
  else throw new Error(
    'ImportedFeature: BRepBuilderAPI_Copy binding not found in opencascade.js',
  );

  const rawCopy = copier.Shape();
  if (typeof copier.delete === 'function') copier.delete();

  const wrapped: OcctShape = { __brand: 'OcctShape', handle: rawCopy };
  const ns: NamedShape = { shape: wrapped, faceNames: [] };

  // Iterate faces in OCCT explorer order, attaching deterministic names.
  type Explorer = {
    More(): boolean;
    Next(): void;
    Current(): unknown;
    delete?(): void;
  };
  const ExpCtor = ocAny.TopExp_Explorer_2 as new (
    s: unknown,
    t: unknown,
    a: unknown,
  ) => Explorer;
  const TAS = ocAny.TopAbs_ShapeEnum as {
    TopAbs_FACE: unknown;
    TopAbs_SHAPE: unknown;
  };
  const exp = new ExpCtor(rawCopy, TAS.TopAbs_FACE, TAS.TopAbs_SHAPE);
  let idx = 0;
  while (exp.More()) {
    const face = exp.Current();
    const name: FaceName = {
      featureId: feature.id,
      role: 'imported-face',
      instance: idx,
    };
    attachName(ns, face, name);
    idx++;
    exp.Next();
  }
  if (typeof exp.delete === 'function') exp.delete();

  return ns;
}
