import type { OcctInstance } from '../occt/occtLoader';
import type { PartDocument, Mesh } from '@zilventor/shared';
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
 * Execution model (Shell MVP):
 *   - Sketches are stashed by id so that a later extrude can look up
 *     its `sketchRef`. In the MVP each sketch feeds exactly one extrude,
 *     but carrying a map keeps the path ready for Sub-project 3's more
 *     complex trees.
 *   - Extrudes produce a fresh solid each time. The "current" solid is
 *     the output of the most recent extrude; if a later extrude runs
 *     we dispose the prior one before overwriting.
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
      // Replace any prior in-flight solid — we only return the last one.
      if (finalSolid) disposeShape(finalSolid);
      finalSolid = ex.value.solid;
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
