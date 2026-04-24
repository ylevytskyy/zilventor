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
import { tessellate } from '../occt/Tessellator';
import { disposeShape, type OcctShape } from '../occt/SolidOps';
import { fuseShapes, cutShapes } from '../occt/BooleanOps';
import { resolve } from './ParameterResolver';

/**
 * The tessellated result of executing a full feature tree. The caller
 * owns `finalSolid` and must dispose it via `disposeShape` once done;
 * `mesh` is plain typed arrays and needs no disposal.
 */
export type ExecutionResult = {
  mesh: Mesh;
  finalSolid: OcctShape;
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
  let finalSolid: OcctShape | null = null;

  const cleanupOnError = (): void => {
    for (const s of sketches.values()) disposeSketchResult(oc, s);
    sketches.clear();
    if (finalSolid) {
      disposeShape(finalSolid);
      finalSolid = null;
    }
  };

  for (const feature of part.featureTree) {
    if (feature.kind === 'sketch') {
      // Skip empty sketches — they are under construction, not an error.
      // An extrude that references one will fail with a clearer error below.
      if (feature.primitives.length === 0) continue;
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

      const applied = applyBooleanOp(oc, finalSolid, ex.value.solid, feature.operation);
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
      // Implemented in T8. For now, do nothing — the feature is skipped so the
      // tree execution completes with prior extrudes as the final solid.
      continue;
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

  const mesh = tessellate(oc, finalSolid, { linearDeflection: 0.1 });
  return ok({ mesh, finalSolid });
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
  running: OcctShape | null,
  next: OcctShape,
  op: BooleanOperation
): Result<OcctShape, KernelError> {
  if (op === 'new') {
    if (running) disposeShape(running);
    return ok(next);
  }
  if (op === 'join') {
    if (!running) return ok(next); // first feature can be Join (treated as seed)
    const r = fuseShapes(oc, running, next);
    disposeShape(running);
    disposeShape(next);
    return r;
  }
  if (op === 'cut') {
    if (!running) {
      disposeShape(next);
      return err({
        kind: 'booleanFailed',
        message: 'Cut needs a target body',
        correlationId: newCorrelationId()
      });
    }
    const r = cutShapes(oc, running, next);
    disposeShape(running);
    disposeShape(next);
    return r;
  }
  disposeShape(next);
  if (running) disposeShape(running);
  return err({
    kind: 'booleanFailed',
    message: `Unknown operation: ${op as string}`,
    correlationId: newCorrelationId()
  });
}
