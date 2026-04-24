import type { OcctInstance } from '../occt/occtLoader';
import type { PartDocument, Mesh, BooleanOperation } from '@zilventor/shared';
import {
  ok,
  err,
  type Result,
  type KernelError,
  newCorrelationId
} from '@zilventor/shared';
import {
  executeSketchFeature,
  disposeSketchResult,
  type SketchResult
} from './features/SketchFeature';
import { executeExtrudeFeature } from './features/ExtrudeFeature';
import { executeRevolveFeature } from './features/RevolveFeature';
import { executeFilletFeature } from './features/FilletFeature';
import { tessellate } from '../occt/Tessellator';
import { disposeShape, type OcctShape } from '../occt/SolidOps';
import { fuseShapes, cutShapes } from '../occt/BooleanOps';
import { type NamedShape, namedFace, attachName } from '../occt/FaceNaming';
import { resolve } from './ParameterResolver';

/**
 * The tessellated result of executing a full feature tree. The caller
 * owns `finalSolid` and must dispose it via `disposeShape` once done;
 * `mesh` is plain typed arrays and needs no disposal.
 *
 * `featureErrors` carries per-feature non-fatal errors (e.g. a fillet
 * whose edge went missing) that should surface to the UI without
 * short-circuiting the whole tree. Only fillet errors populate it in
 * Sub-project 3b T13; extrude/revolve still short-circuit to a hard
 * error return. T14 will tighten this to a non-optional field.
 */
export type ExecutionResult = {
  mesh: Mesh;
  finalSolid: OcctShape;
  featureErrors?: Map<string, KernelError>;
};

/**
 * Runs a PartDocument's feature tree top-to-bottom, returning the mesh
 * of the final solid plus the solid handle for downstream consumers.
 *
 * Execution model (Sub-project 3a):
 *   - Sketches are stashed by id so that a later extrude can look up
 *     its `sketchRef`. Each sketch feeds exactly one extrude in the
 *     MVP, but carrying a map keeps the path ready for more complex
 *     trees.
 *   - Extrudes route through `applyBooleanOp(running, next, op)` which
 *     maintains a single running solid accumulator:
 *       - `op: 'new'`  — dispose running (if any), use next as the new running.
 *       - `op: 'join'` — fuse running with next (seed behavior if no running).
 *       - `op: 'cut'`  — err if no running; else cut(running, next).
 *   - Errors short-circuit: on the first failing feature we return the
 *     error. Any sketches accumulated so far are disposed in the
 *     `finally`-equivalent block at the end of the happy path, but on
 *     the error path we rely on the catch below. (Keeping the dispose
 *     in both branches keeps the accounting symmetric.)
 *
 * Memory discipline:
 *   - Every SketchResult created is disposed before we return.
 *   - At most one in-flight `finalSolid` is alive at a time; prior
 *     solids are disposed when replaced.
 *   - On error we dispose any partial sketch wires and the current
 *     `finalSolid` so the caller never has to reason about half-built
 *     state.
 */
export async function executeTree(
  oc: OcctInstance,
  part: PartDocument
): Promise<Result<ExecutionResult, KernelError>> {
  const sketches = new Map<string, SketchResult>();
  let finalSolid: NamedShape | null = null;
  const featureErrors = new Map<string, KernelError>();

  const cleanupOnError = (): void => {
    for (const s of sketches.values()) disposeSketchResult(oc, s);
    sketches.clear();
    if (finalSolid) {
      disposeShape(finalSolid.shape);
      finalSolid = null;
    }
  };

  // Pre-scan to classify each sketch by downstream consumer. A sketch
  // referenced by a revolve contains both a closed profile AND an axis
  // line — a shape `executeSketchFeature` rejects as degenerate ("valid
  // loop plus disconnected line(s)"). Such a sketch is consumed
  // directly by the revolve branch (which builds its own edges, excluding
  // the axis primitive), so we must NOT run `executeSketchFeature` on it.
  const revolveSketchIds = new Set<string>();
  for (const f of part.featureTree) {
    if (f.kind === 'revolve') revolveSketchIds.add(f.sketchRef);
  }

  for (const feature of part.featureTree) {
    if (feature.kind === 'sketch') {
      // Skip empty sketches — they are under construction, not an error.
      // An extrude that references one will fail with a clearer error below.
      if (feature.primitives.length === 0) continue;
      // A revolve-only sketch (profile + axis line) is processed directly
      // by the revolve branch below; `executeSketchFeature` would reject it
      // as a disconnected-loop sketch. Skip it here.
      if (revolveSketchIds.has(feature.id)) continue;
      const r = executeSketchFeature(oc, feature);
      if (!r.ok) {
        cleanupOnError();
        return r;
      }
      sketches.set(feature.id, r.value);
    } else if (feature.kind === 'extrude') {
      const sketch = sketches.get(feature.sketchRef);
      if (!sketch) {
        cleanupOnError();
        return err({
          kind: 'featureNotFound',
          message: `Sketch ${feature.sketchRef} not found`,
          correlationId: newCorrelationId(),
          featureId: feature.id
        });
      }
      const param = part.parameters[feature.distanceParam];
      if (!param) {
        cleanupOnError();
        return err({
          kind: 'invalidParameter',
          message: `Parameter ${feature.distanceParam} not found`,
          correlationId: newCorrelationId(),
          featureId: feature.id
        });
      }
      const resolved = resolve(param.expression, param.unit);
      if (!resolved.ok) {
        cleanupOnError();
        return resolved;
      }

      const ex = executeExtrudeFeature(oc, sketch, feature, resolved.value);
      if (!ex.ok) {
        cleanupOnError();
        return ex;
      }

      const applied = applyBooleanOp(oc, finalSolid, ex.value.named, feature.operation, feature.id);
      if (!applied.ok) {
        // applyBooleanOp has already disposed the freshly made solid (and the
        // running body for the fuse/cut branches); we only need to clear our
        // local handle so cleanupOnError doesn't double-free.
        finalSolid = null;
        cleanupOnError();
        return applied;
      }
      finalSolid = applied.value;
    } else if (feature.kind === 'revolve') {
      // Revolve does NOT rely on the `sketches` Map: a revolve sketch contains
      // both a closed profile AND an axis line (an open chain), which is
      // exactly the shape `executeSketchFeature` rejects as degenerate. So we
      // look up the raw sketch feature from the tree and pass it straight to
      // `executeRevolveFeature`, which builds its own edges/wires excluding
      // the axis primitive. See RevolveFeature.ts "Signature note" comment.
      const sketchFeature = part.featureTree.find(
        (f) => f.kind === 'sketch' && f.id === feature.sketchRef
      );
      if (!sketchFeature || sketchFeature.kind !== 'sketch') {
        cleanupOnError();
        return err({
          kind: 'featureNotFound',
          message: `Sketch ${feature.sketchRef} not found for revolve`,
          correlationId: newCorrelationId(),
          featureId: feature.id
        });
      }
      const param = part.parameters[feature.angleParam];
      if (!param) {
        cleanupOnError();
        return err({
          kind: 'invalidParameter',
          message: `Parameter ${feature.angleParam} not found`,
          correlationId: newCorrelationId(),
          featureId: feature.id
        });
      }
      const resolved = resolve(param.expression, param.unit);
      if (!resolved.ok) {
        cleanupOnError();
        return resolved;
      }
      // `resolve` returns the raw numeric value; the angle parameter is in
      // degrees (ParameterUnit 'deg'), so convert to radians here.
      const angleRad = (resolved.value * Math.PI) / 180;

      const rv = executeRevolveFeature(oc, sketchFeature, feature, angleRad);
      if (!rv.ok) {
        cleanupOnError();
        return rv;
      }

      const applied = applyBooleanOp(oc, finalSolid, rv.value.named, feature.operation, feature.id);
      if (!applied.ok) {
        // applyBooleanOp already disposed running + next on failure (for
        // fuse/cut branches); clear our handle so cleanupOnError doesn't
        // double-free.
        finalSolid = null;
        cleanupOnError();
        return applied;
      }
      finalSolid = applied.value;
    } else if (feature.kind === 'fillet') {
      // A fillet modifies an existing body — without one there's nothing to
      // modify. This is a soft error (recorded in featureErrors) so later
      // features in the tree can still execute; it does not short-circuit
      // the whole rebuild.
      if (!finalSolid) {
        featureErrors.set(feature.id, {
          kind: 'invalidParameter',
          message: 'Fillet needs a body to modify',
          correlationId: newCorrelationId(),
          featureId: feature.id
        });
        continue;
      }
      const result = executeFilletFeature(oc, finalSolid, feature, (p) => {
        if (p.kind === 'literal') return ok(p.value);
        const param = part.parameters[p.paramName];
        if (!param) {
          return err({
            kind: 'invalidParameter',
            message: `Parameter ${p.paramName} not found`,
            correlationId: newCorrelationId(),
            featureId: feature.id
          });
        }
        return resolve(param.expression, param.unit);
      });
      if (!result.ok) {
        // Soft-fail: record the error, keep the pre-fillet body intact, and
        // continue. The UI can annotate the fillet node while the rest of
        // the tree rebuilds normally.
        featureErrors.set(feature.id, result.error);
        continue;
      }
      disposeShape(finalSolid.shape);
      finalSolid = result.value;
    }
  }

  // Sketches have fed every extrude that needed them; release now.
  for (const s of sketches.values()) disposeSketchResult(oc, s);
  sketches.clear();

  if (!finalSolid) {
    return err({
      kind: 'degenerateSketch',
      message: 'Feature tree produced no solid',
      correlationId: newCorrelationId()
    });
  }

  const mesh = tessellate(oc, finalSolid.shape, { linearDeflection: 0.1 });
  // API compatibility: `ExecutionResult.finalSolid` is OcctShape (the raw
  // handle wrapper). Callers dispose it via `disposeShape`; they don't need
  // the NamedShape metadata here. The name map stays inside the executor.
  return ok({
    mesh,
    finalSolid: finalSolid.shape,
    ...(featureErrors.size > 0 ? { featureErrors } : {})
  });
}

/**
 * Routes an extrude's output through the running-body accumulator according
 * to the feature's `BooleanOperation`.
 *
 * Ownership rules:
 *   - On success, callers get back a single fresh shape (the new running
 *     body). Any prior running shape and the `next` input have been disposed
 *     where the op consumed them.
 *   - On failure, both `running` (if the helper had already combined it) and
 *     `next` are disposed here so the caller never needs to reason about
 *     partial state. The caller is responsible for clearing its own pointer
 *     to `running` before invoking `cleanupOnError` to avoid a double-free.
 *
 * Semantics:
 *   - `new`   — discard `running` (if any), return `next` as the new body.
 *   - `join`  — fuse `running` with `next`; if there is no running body this
 *               is the first feature and `next` becomes the seed.
 *   - `cut`   — subtract `next` from `running`; err if there is no running
 *               body (nothing to cut from).
 */
function applyBooleanOp(
  oc: OcctInstance,
  running: NamedShape | null,
  next: NamedShape,
  op: BooleanOperation,
  featureId: string
): Result<NamedShape, KernelError> {
  if (op === 'new') {
    if (running) disposeShape(running.shape);
    return ok(next);
  }
  if (op === 'join') {
    if (!running) return ok(next); // first feature can be Join (treated as seed)
    const r = fuseShapes(oc, running.shape, next.shape);
    if (!r.ok) {
      disposeShape(running.shape);
      disposeShape(next.shape);
      return err({ ...r.error, featureId });
    }
    const merged = mergeFaceNames(oc, r.value, running, next, featureId);
    disposeShape(running.shape);
    disposeShape(next.shape);
    return ok(merged);
  }
  if (op === 'cut') {
    if (!running) {
      disposeShape(next.shape);
      return err({
        kind: 'booleanFailed',
        message: 'Cut needs a target body',
        correlationId: newCorrelationId(),
        featureId
      });
    }
    const r = cutShapes(oc, running.shape, next.shape);
    if (!r.ok) {
      disposeShape(running.shape);
      disposeShape(next.shape);
      return err({ ...r.error, featureId });
    }
    const merged = mergeFaceNames(oc, r.value, running, next, featureId);
    disposeShape(running.shape);
    disposeShape(next.shape);
    return ok(merged);
  }
  disposeShape(next.shape);
  if (running) disposeShape(running.shape);
  const _exhaustive: never = op;
  return err({
    kind: 'booleanFailed',
    message: `Unknown operation: ${String(_exhaustive)}`,
    correlationId: newCorrelationId(),
    featureId
  });
}

/**
 * Build a NamedShape around a boolean-op result by reusing face names from
 * the two operand NamedShapes. A face in the result keeps the name of
 * whichever operand face it IsSame-matches; faces that don't match any
 * operand (i.e. new topology produced by the boolean) receive a synthetic
 * `{featureId}/opResult/{n}` name so downstream features can still address
 * them deterministically.
 *
 * This is the T13 minimum: IsSame comparison across both operands, no
 * topology inference beyond that. T15+ may refine with Modified/Generated/
 * IsDeleted tracking from BRepAlgoAPI_BooleanOperation.
 */
function mergeFaceNames(
  oc: OcctInstance,
  resultShape: OcctShape,
  a: NamedShape,
  b: NamedShape,
  featureId: string
): NamedShape {
  const named: NamedShape = { shape: resultShape, faceNames: [] };
  const map = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(
    resultShape.handle as never,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    map as never
  );
  const extent = (map as { Extent: () => number }).Extent();
  let unnamedIdx = 0;
  for (let i = 1; i <= extent; i++) {
    const faceShape = (map as { FindKey: (i: number) => unknown }).FindKey(i);
    const face = (oc.TopoDS as { Face_1: (s: unknown) => unknown }).Face_1(
      faceShape as never
    );
    // Prefer A (the running body) over B (the incoming feature) for ambiguous
    // matches — running-body names are older and more likely to be bound by
    // downstream features.
    const surviving =
      a.faceNames.find((f) =>
        (face as { IsSame?: (o: unknown) => boolean }).IsSame?.(f.face as never)
      ) ??
      b.faceNames.find((f) =>
        (face as { IsSame?: (o: unknown) => boolean }).IsSame?.(f.face as never)
      );
    if (surviving) {
      attachName(named, face, surviving.name);
    } else {
      attachName(named, face, namedFace(featureId, 'opResult', unnamedIdx++));
    }
  }
  map.delete();
  return named;
}
