import type { OcctInstance } from '../occt/occtLoader';
import type { PartDocument, Mesh, BooleanOperation, TessellatedEdge, TessellatedFace, FaceName, WorkFeatureValue } from '@zilventor/shared';
import {
  ok,
  err,
  type Result,
  type KernelError,
  newCorrelationId
} from '@zilventor/shared';
import { evaluateWorkAxis, evaluateWorkPlane, evaluateWorkPoint } from '../occt/WorkFeatureOps';
import {
  executeSketchFeature,
  disposeSketchResult,
  type SketchResult
} from './features/SketchFeature';
import { executeExtrudeFeature } from './features/ExtrudeFeature';
import { executeRevolveFeature } from './features/RevolveFeature';
import { executeFilletFeature } from './features/FilletFeature';
import { executeChamferFeature } from './features/ChamferFeature';
import { executeShellFeature } from './features/ShellFeature';
import { executeLinearPatternFeature } from './features/LinearPatternFeature';
import { executeMirrorFeature } from './features/MirrorFeature';
import { executeHoleFeature } from './features/HoleFeature';
import { executeSweepFeature } from './features/SweepFeature';
import { executeImportedFeature } from './features/ImportedFeature';
import { evaluatePanel } from './features/PanelFeature';
import { tessellate, tessellateEdges, tessellateFaces, adaptiveLinearDeflection } from '../occt/Tessellator';
import { panelUvProjection, type UvProjection, buildGrooveCutter } from '@zilventor/shared';
import { disposeShape, computeBoundingBox, makeBoxFromCorners, type OcctShape } from '../occt/SolidOps';
import { fuseShapes, cutShapes } from '../occt/BooleanOps';
import { type NamedShape, attachName, mergeFaceNames } from '../occt/FaceNaming';
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
  /** The full NamedShape (solid + face-handle → name mapping) produced by the
   *  feature tree. Callers that need to resolve face/edge refs by name (e.g.
   *  assembly constraint extractors) use this instead of `finalSolid` alone.
   *  Ownership: the caller is responsible for disposing `namedShape.shape` via
   *  `disposeShape` when done; `finalSolid` is an alias to `namedShape.shape`
   *  and must not be disposed separately.
   */
  namedShape: NamedShape;
  tessellatedEdges?: TessellatedEdge[];
  /** Face names of the final solid. Exposed so UI can populate pickers
   *  (e.g. the Shell dialog's "face to remove" dropdown) without having
   *  to reason about BRep topology.
   */
  faceNames?: FaceName[];
  /** Per-face triangle ranges of the final solid. Used by viewport
   *  face-pick raycast to map a hit triangle to its FaceName without
   *  the app layer having to know about BRep topology.
   */
  tessellatedFaces?: TessellatedFace[];
  featureErrors?: Map<string, KernelError>;
  /** Evaluated work-feature values (axes/planes/points), in feature-tree order.
   *  Origin features always appear first; user-created features follow.
   *  Failures populate `featureErrors` and are omitted from this list.
   */
  workFeatures?: WorkFeatureValue[];
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
  part: PartDocument,
  /** Lookup for ImportedFeature bodies. Required when the tree contains
   *  any kind:'imported' feature; T8 wires the dispatch. */
  lookupImportedShape?: (bodyRef: string) => OcctShape | undefined,
): Promise<Result<ExecutionResult, KernelError>> {
  const sketches = new Map<string, SketchResult>();
  let finalSolid: NamedShape | null = null;
  const featureErrors = new Map<string, KernelError>();
  const workFeatureCache = new Map<string, WorkFeatureValue>();

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
  //
  // A sketch referenced by a hole's fromSketch placement is consumed
  // directly by the hole branch (it reads circle primitives for axis
  // locations) and must similarly bypass `executeSketchFeature`.
  const revolveSketchIds = new Set<string>();
  const holeSketchIds = new Set<string>();
  const sweepSketchIds = new Set<string>();
  const sketchById = new Map<string, (typeof part.featureTree)[number]>();
  for (const f of part.featureTree) {
    if (f.kind === 'revolve') revolveSketchIds.add(f.sketchRef);
    if (f.kind === 'hole' && f.placement.kind === 'fromSketch') {
      holeSketchIds.add(f.placement.sketchId);
    }
    if (f.kind === 'sweep') {
      sweepSketchIds.add(f.profileSketchId);
      sweepSketchIds.add(f.pathSketchId);
      if (f.orientation.kind === 'guideRail') {
        sweepSketchIds.add(f.orientation.guideRailSketchId);
      }
    }
    if (f.kind === 'sketch') sketchById.set(f.id, f);
  }

  for (const feature of part.featureTree) {
    // Inline work-feature evaluation: origin features come first in the tree
    // (seeded by newPart / migration), so by the time a downstream sketch or
    // user-created work feature references the cache, prior entries are
    // already populated. Failures route to featureErrors and skip the rest of
    // the tree at this index.
    if (feature.kind === 'workAxis') {
      const r = evaluateWorkAxis(oc, finalSolid, feature.source, workFeatureCache);
      if (r.ok) {
        workFeatureCache.set(feature.id, { featureId: feature.id, kind: 'axis', origin: r.value.origin, direction: r.value.direction });
      } else {
        featureErrors.set(feature.id, r.error);
      }
      continue;
    }
    if (feature.kind === 'workPlane') {
      const r = evaluateWorkPlane(oc, finalSolid, feature.source, workFeatureCache, part.parameters);
      if (r.ok) {
        workFeatureCache.set(feature.id, { featureId: feature.id, kind: 'plane', origin: r.value.origin, normal: r.value.normal });
      } else {
        featureErrors.set(feature.id, r.error);
      }
      continue;
    }
    if (feature.kind === 'workPoint') {
      const r = evaluateWorkPoint(oc, finalSolid, feature.source, workFeatureCache);
      if (r.ok) {
        workFeatureCache.set(feature.id, { featureId: feature.id, kind: 'point', position: r.value.position });
      } else {
        featureErrors.set(feature.id, r.error);
      }
      continue;
    }
    if (feature.kind === 'sketch') {
      // Skip empty sketches — they are under construction, not an error.
      // An extrude that references one will fail with a clearer error below.
      if (feature.primitives.length === 0) continue;
      // A revolve-only sketch (profile + axis line) is processed directly
      // by the revolve branch below; `executeSketchFeature` would reject it
      // as a disconnected-loop sketch. Skip it here.
      if (revolveSketchIds.has(feature.id)) continue;
      // A hole-referenced sketch is consumed directly by the hole branch
      // (circle primitives → axis locations). Skip `executeSketchFeature`
      // so it stays raw in `sketchById` for the hole branch to read.
      if (holeSketchIds.has(feature.id)) continue;
      // A sweep-referenced sketch (profile, path, or guide rail) is consumed
      // directly by the sweep branch via `sketchById`. Skip
      // `executeSketchFeature` so it stays raw for the sweep branch to read.
      if (sweepSketchIds.has(feature.id)) continue;
      const r = executeSketchFeature(oc, feature, workFeatureCache);
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
    } else if (feature.kind === 'chamfer') {
      // Chamfer follows the same soft-fail pattern as fillet — without a
      // body to modify there's nothing to do, and if the chamfer op itself
      // fails (edge missing, zero distance, OCCT converge failure) we record
      // the error and keep the pre-chamfer body intact.
      if (!finalSolid) {
        featureErrors.set(feature.id, {
          kind: 'invalidParameter',
          message: 'Chamfer needs a body to modify',
          correlationId: newCorrelationId(),
          featureId: feature.id
        });
        continue;
      }
      const result = executeChamferFeature(oc, finalSolid, feature, (p) => {
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
        featureErrors.set(feature.id, result.error);
        continue;
      }
      disposeShape(finalSolid.shape);
      finalSolid = result.value;
    } else if (feature.kind === 'shell') {
      if (!finalSolid) {
        featureErrors.set(feature.id, {
          kind: 'invalidParameter',
          message: 'Shell needs a body to modify',
          correlationId: newCorrelationId(),
          featureId: feature.id
        });
        continue;
      }
      const result = executeShellFeature(oc, finalSolid, feature, (p) => {
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
        featureErrors.set(feature.id, result.error);
        continue;
      }
      disposeShape(finalSolid.shape);
      finalSolid = result.value;
    } else if (feature.kind === 'pattern-linear') {
      // Re-execute the source feature in isolation to get a standalone
      // shape, then translate + boolean-op count-1 copies into the running
      // body. Only extrude and revolve source features are supported today
      // (fillet/chamfer/shell don't produce standalone shapes).
      if (!finalSolid) {
        featureErrors.set(feature.id, {
          kind: 'invalidParameter',
          message: 'Linear pattern needs a body to modify',
          correlationId: newCorrelationId(),
          featureId: feature.id
        });
        continue;
      }
      const source = part.featureTree.find((f) => f.id === feature.sourceFeatureId);
      if (!source || (source.kind !== 'extrude' && source.kind !== 'revolve')) {
        featureErrors.set(feature.id, {
          kind: 'invalidParameter',
          message: `Linear pattern source ${feature.sourceFeatureId} must be an extrude or revolve`,
          correlationId: newCorrelationId(),
          featureId: feature.id
        });
        continue;
      }
      let sourceShape: NamedShape | null = null;
      if (source.kind === 'extrude') {
        const sketch = sketches.get(source.sketchRef);
        if (!sketch) {
          featureErrors.set(feature.id, {
            kind: 'featureNotFound',
            message: `Source extrude's sketch ${source.sketchRef} missing`,
            correlationId: newCorrelationId(),
            featureId: feature.id
          });
          continue;
        }
        const param = part.parameters[source.distanceParam];
        if (!param) {
          featureErrors.set(feature.id, {
            kind: 'invalidParameter',
            message: `Source extrude parameter ${source.distanceParam} missing`,
            correlationId: newCorrelationId(),
            featureId: feature.id
          });
          continue;
        }
        const resolved = resolve(param.expression, param.unit);
        if (!resolved.ok) {
          featureErrors.set(feature.id, { ...resolved.error, featureId: feature.id });
          continue;
        }
        const ex = executeExtrudeFeature(oc, sketch, source, resolved.value);
        if (!ex.ok) {
          featureErrors.set(feature.id, { ...ex.error, featureId: feature.id });
          continue;
        }
        sourceShape = ex.value.named;
      } else {
        // revolve
        const sketchFeature = part.featureTree.find(
          (f) => f.kind === 'sketch' && f.id === source.sketchRef
        );
        if (!sketchFeature || sketchFeature.kind !== 'sketch') {
          featureErrors.set(feature.id, {
            kind: 'featureNotFound',
            message: `Source revolve's sketch ${source.sketchRef} missing`,
            correlationId: newCorrelationId(),
            featureId: feature.id
          });
          continue;
        }
        const param = part.parameters[source.angleParam];
        if (!param) {
          featureErrors.set(feature.id, {
            kind: 'invalidParameter',
            message: `Source revolve parameter ${source.angleParam} missing`,
            correlationId: newCorrelationId(),
            featureId: feature.id
          });
          continue;
        }
        const resolved = resolve(param.expression, param.unit);
        if (!resolved.ok) {
          featureErrors.set(feature.id, { ...resolved.error, featureId: feature.id });
          continue;
        }
        const angleRad = (resolved.value * Math.PI) / 180;
        const rv = executeRevolveFeature(oc, sketchFeature, source, angleRad);
        if (!rv.ok) {
          featureErrors.set(feature.id, { ...rv.error, featureId: feature.id });
          continue;
        }
        sourceShape = rv.value.named;
      }
      let spacingResolved: Result<number, KernelError>;
      if (feature.spacing.kind === 'literal') {
        spacingResolved = ok(feature.spacing.value);
      } else {
        const p = part.parameters[feature.spacing.paramName];
        if (!p) {
          spacingResolved = err({
            kind: 'invalidParameter',
            message: `Pattern spacing param ${feature.spacing.paramName} not found`,
            correlationId: newCorrelationId(),
            featureId: feature.id
          });
        } else {
          spacingResolved = resolve(p.expression, p.unit);
        }
      }
      if (!spacingResolved.ok) {
        disposeShape(sourceShape.shape);
        featureErrors.set(feature.id, { ...spacingResolved.error, featureId: feature.id });
        continue;
      }
      const patternResult = executeLinearPatternFeature(oc, {
        runningBody: finalSolid,
        sourceShape: sourceShape.shape,
        operation: source.operation,
        direction: feature.direction,
        spacing: spacingResolved.value,
        count: feature.count,
        featureId: feature.id
      });
      disposeShape(sourceShape.shape);
      if (!patternResult.ok) {
        featureErrors.set(feature.id, patternResult.error);
        continue;
      }
      // executeLinearPatternFeature consumed the running body when it
      // boolean-op'd copies in. Update our pointer without a
      // double-dispose.
      finalSolid = patternResult.value;
    } else if (feature.kind === 'mirror') {
      // Mirror reuses the linear-pattern strategy: re-execute the source
      // feature in isolation, reflect the result across a world plane,
      // boolean-op the copy into the running body.
      if (!finalSolid) {
        featureErrors.set(feature.id, {
          kind: 'invalidParameter',
          message: 'Mirror needs a body to modify',
          correlationId: newCorrelationId(),
          featureId: feature.id
        });
        continue;
      }
      const source = part.featureTree.find((f) => f.id === feature.sourceFeatureId);
      if (!source || (source.kind !== 'extrude' && source.kind !== 'revolve')) {
        featureErrors.set(feature.id, {
          kind: 'invalidParameter',
          message: `Mirror source ${feature.sourceFeatureId} must be an extrude or revolve`,
          correlationId: newCorrelationId(),
          featureId: feature.id
        });
        continue;
      }
      let sourceShape: NamedShape | null = null;
      if (source.kind === 'extrude') {
        const sketch = sketches.get(source.sketchRef);
        if (!sketch) {
          featureErrors.set(feature.id, {
            kind: 'featureNotFound',
            message: `Source extrude's sketch ${source.sketchRef} missing`,
            correlationId: newCorrelationId(),
            featureId: feature.id
          });
          continue;
        }
        const param = part.parameters[source.distanceParam];
        if (!param) {
          featureErrors.set(feature.id, {
            kind: 'invalidParameter',
            message: `Source extrude parameter ${source.distanceParam} missing`,
            correlationId: newCorrelationId(),
            featureId: feature.id
          });
          continue;
        }
        const resolved = resolve(param.expression, param.unit);
        if (!resolved.ok) {
          featureErrors.set(feature.id, { ...resolved.error, featureId: feature.id });
          continue;
        }
        const ex = executeExtrudeFeature(oc, sketch, source, resolved.value);
        if (!ex.ok) {
          featureErrors.set(feature.id, { ...ex.error, featureId: feature.id });
          continue;
        }
        sourceShape = ex.value.named;
      } else {
        const sketchFeature = part.featureTree.find(
          (f) => f.kind === 'sketch' && f.id === source.sketchRef
        );
        if (!sketchFeature || sketchFeature.kind !== 'sketch') {
          featureErrors.set(feature.id, {
            kind: 'featureNotFound',
            message: `Source revolve's sketch ${source.sketchRef} missing`,
            correlationId: newCorrelationId(),
            featureId: feature.id
          });
          continue;
        }
        const param = part.parameters[source.angleParam];
        if (!param) {
          featureErrors.set(feature.id, {
            kind: 'invalidParameter',
            message: `Source revolve parameter ${source.angleParam} missing`,
            correlationId: newCorrelationId(),
            featureId: feature.id
          });
          continue;
        }
        const resolved = resolve(param.expression, param.unit);
        if (!resolved.ok) {
          featureErrors.set(feature.id, { ...resolved.error, featureId: feature.id });
          continue;
        }
        const angleRad = (resolved.value * Math.PI) / 180;
        const rv = executeRevolveFeature(oc, sketchFeature, source, angleRad);
        if (!rv.ok) {
          featureErrors.set(feature.id, { ...rv.error, featureId: feature.id });
          continue;
        }
        sourceShape = rv.value.named;
      }
      const mirrorResult = executeMirrorFeature(oc, {
        runningBody: finalSolid,
        sourceShape: sourceShape.shape,
        operation: source.operation,
        plane: feature.plane,
        featureId: feature.id
      });
      disposeShape(sourceShape.shape);
      if (!mirrorResult.ok) {
        featureErrors.set(feature.id, mirrorResult.error);
        continue;
      }
      finalSolid = mirrorResult.value;
    } else if (feature.kind === 'hole') {
      // Hole modifies an existing body — without one there's nothing to drill.
      // Soft-fail mirroring fillet/chamfer/shell.
      if (!finalSolid) {
        featureErrors.set(feature.id, {
          kind: 'invalidParameter',
          message: 'Hole needs a body to modify',
          correlationId: newCorrelationId(),
          featureId: feature.id
        });
        continue;
      }
      try {
        // executeHoleFeature operates on raw OCCT handles (not OcctShape wrappers).
        // Unwrap the running body's shape handle so the adapter's BRepBndLib / cut
        // calls receive the raw OCCT shape, then rewrap the result back into an
        // OcctShape so FeatureTree's disposeShape / tessellate calls work correctly.
        const rawHandle = (finalSolid.shape as unknown as { handle: unknown }).handle;
        const bodyForHole: typeof finalSolid = {
          ...finalSolid,
          shape: rawHandle as typeof finalSolid.shape
        };
        const holeResult = executeHoleFeature(
          oc,
          bodyForHole,
          feature,
          (p) => {
            if (p.kind === 'literal') return p.value;
            const param = part.parameters[p.paramName];
            if (!param) throw new Error(`Parameter ${p.paramName} not found`);
            const resolved = resolve(param.expression, param.unit);
            if (!resolved.ok) throw new Error(resolved.error.message);
            return resolved.value;
          },
          sketchById
        );
        // Rewrap: holeResult.shape is the raw OCCT handle returned by makeHole/cut.
        finalSolid = {
          ...holeResult,
          shape: { __brand: 'OcctShape' as const, handle: holeResult.shape } as typeof finalSolid.shape
        };
      } catch (e) {
        // Soft-fail: keep the pre-hole body intact and record the error.
        featureErrors.set(feature.id, {
          kind: 'invalidParameter',
          message: (e instanceof Error) ? e.message : String(e),
          correlationId: newCorrelationId(),
          featureId: feature.id
        });
        continue;
      }
    } else if (feature.kind === 'groove') {
      // Groove cuts a parametric channel into an existing body. Without a body
      // there's nothing to cut — soft-fail (same convention as hole/sweep).
      if (!finalSolid) {
        featureErrors.set(feature.id, {
          kind: 'invalidParameter',
          message: 'Groove needs a body to modify',
          correlationId: newCorrelationId(),
          featureId: feature.id
        });
        continue;
      }
      try {
        // Panel dims from the running body's bbox. buildPanelBox is centred in
        // X/Y with its base at Z=0, so bbox sizes reproduce face2DFrame's frame.
        const [xmin, ymin, zmin, xmax, ymax, zmax] = computeBoundingBox(oc, finalSolid.shape);
        const panelDims = { length: xmax - xmin, width: ymax - ymin, thickness: zmax - zmin };
        const { p1, p2 } = buildGrooveCutter(panelDims, feature);
        const cutter = makeBoxFromCorners(oc, p1, p2);
        const cut = cutShapes(oc, finalSolid.shape, cutter);
        disposeShape(cutter);
        if (!cut.ok) {
          featureErrors.set(feature.id, { ...cut.error, featureId: feature.id });
          continue;
        }
        finalSolid = { shape: cut.value, faceNames: finalSolid.faceNames };
      } catch (e) {
        featureErrors.set(feature.id, {
          kind: 'invalidParameter',
          message: (e instanceof Error) ? e.message : String(e),
          correlationId: newCorrelationId(),
          featureId: feature.id
        });
        continue;
      }
    } else if (feature.kind === 'sweep') {
      if (!finalSolid && feature.operation !== 'new') {
        featureErrors.set(feature.id, {
          kind: 'invalidParameter',
          message: 'Sweep needs a body to modify',
          correlationId: newCorrelationId(),
          featureId: feature.id
        });
        continue;
      }
      try {
        // Unwrap the OcctShape wrapper before passing to executeSweepFeature —
        // SweepFeature.ts expects runningBody.shape to be a raw OCCT handle
        // (same pattern as the hole branch above at lines 605-608).
        const sweepRunning = finalSolid
          ? {
              ...finalSolid,
              shape: (finalSolid.shape as unknown as { handle: unknown }).handle as typeof finalSolid.shape
            }
          : null;
        const sweepResult = executeSweepFeature(oc, sweepRunning, feature, sketchById);
        // executeSweepFeature returns a NamedShape where .shape is a raw OCCT
        // handle (not an OcctShape wrapper). Wrap it so disposeShape /
        // tessellate calls work correctly — same pattern as the hole branch.
        finalSolid = {
          ...sweepResult,
          shape: { __brand: 'OcctShape' as const, handle: sweepResult.shape } as OcctShape
        };
      } catch (e) {
        // Soft-fail: keep the pre-sweep body intact and record the error.
        featureErrors.set(feature.id, {
          kind: 'invalidParameter',
          message: (e instanceof Error) ? e.message : String(e),
          correlationId: newCorrelationId(),
          featureId: feature.id
        });
        continue;
      }
    } else if (feature.kind === 'panel') {
      // PanelFeature is a base feature: it must be the first user-visible
      // feature in the part (origin features are skipped when computing the
      // index). The evaluator enforces PANEL_NOT_BASE_FEATURE when
      // featureIndex !== 0; we count user features ahead of this panel by
      // walking the prefix of the tree.
      let userFeatureIndex = 0;
      for (const prior of part.featureTree) {
        if (prior === feature) break;
        if (
          prior.kind === 'workAxis' ||
          prior.kind === 'workPlane' ||
          prior.kind === 'workPoint'
        ) {
          continue;
        }
        userFeatureIndex++;
      }
      // Adapt `part.parameters` (SketchParameter with `unit`) to the shape
      // `evaluatePanel` expects (`{ value, expression, units }`). Only
      // `.value` is read by the resolver, so this remap is purely
      // structural.
      const adaptedParams: Record<string, { value: number; expression: string; units: string }> = {};
      for (const [k, p] of Object.entries(part.parameters)) {
        adaptedParams[k] = { value: p.value, expression: p.expression, units: p.unit };
      }
      let panelResult: ReturnType<typeof evaluatePanel>;
      try {
        panelResult = evaluatePanel(oc, feature, {
          parameters: adaptedParams,
          featureIndex: userFeatureIndex,
        });
      } catch (e) {
        cleanupOnError();
        return err({
          kind: 'invalidGeometry',
          message: `PanelFeature ${feature.id}: ${(e as Error).message}`,
          correlationId: newCorrelationId(),
          featureId: feature.id,
        });
      }
      if (panelResult.skipped) continue;
      // Panel semantically replaces the running solid (it is by invariant
      // the first user feature, but defensively dispose any prior body so
      // a panel-after-panel insertion attempt doesn't leak).
      if (finalSolid) {
        disposeShape(finalSolid.shape);
        finalSolid = null;
      }
      // Bind face handles from the panel shape to the canonical FaceNames
      // produced by buildPanelBox. Classification mirrors PanelOps' own
      // centroid-vs-bbox-center logic so the same face gets the same name
      // across rebuilds. (We reclassify here rather than threading face
      // handles out of buildPanelBox to keep the PanelOps API minimal.)
      const rawShape = panelResult.shape;
      const panelFaceNames = panelResult.faceNames!;
      const named: NamedShape = {
        shape: { __brand: 'OcctShape', handle: rawShape } as OcctShape,
        faceNames: [],
      };
      const ocAny = oc as unknown as {
        Bnd_Box_1: new () => {
          CornerMin: () => { X: () => number; Y: () => number; Z: () => number };
          CornerMax: () => { X: () => number; Y: () => number; Z: () => number };
          delete: () => void;
        };
        BRepBndLib: { Add: (s: unknown, b: unknown, useTri: unknown) => void };
        TopExp_Explorer_2: new (s: unknown, t: unknown, a: unknown) => {
          More: () => boolean;
          Current: () => unknown;
          Next: () => void;
          delete: () => void;
        };
        TopAbs_ShapeEnum: { TopAbs_FACE: unknown; TopAbs_SHAPE: unknown };
        GProp_GProps_1: new () => {
          CentreOfMass: () => { X: () => number; Y: () => number; Z: () => number };
          delete: () => void;
        };
        BRepGProp: {
          SurfaceProperties_1: (s: unknown, p: unknown, eps: number, useTri: boolean) => void;
        };
      };
      const bb = new ocAny.Bnd_Box_1();
      ocAny.BRepBndLib.Add(rawShape as never, bb as never, false as never);
      const cmin = bb.CornerMin();
      const cmax = bb.CornerMax();
      const cx = (cmin.X() + cmax.X()) / 2;
      const cy = (cmin.Y() + cmax.Y()) / 2;
      const cz = (cmin.Z() + cmax.Z()) / 2;
      (cmin as unknown as { delete: () => void }).delete();
      (cmax as unknown as { delete: () => void }).delete();
      bb.delete();
      const expl = new ocAny.TopExp_Explorer_2(
        rawShape,
        ocAny.TopAbs_ShapeEnum.TopAbs_FACE,
        ocAny.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      while (expl.More()) {
        const face = expl.Current();
        const props = new ocAny.GProp_GProps_1();
        ocAny.BRepGProp.SurfaceProperties_1(face, props, 1e-7, false);
        const com = props.CentreOfMass();
        const dx = com.X() - cx;
        const dy = com.Y() - cy;
        const dz = com.Z() - cz;
        (com as unknown as { delete: () => void }).delete();
        props.delete();
        const ax = Math.abs(dx);
        const ay = Math.abs(dy);
        const az = Math.abs(dz);
        const eps = 1e-6;
        let role: 'Top' | 'Bottom' | 'Front' | 'Back' | 'Left' | 'Right' | null = null;
        if (az >= ax && az >= ay && az > eps) role = dz > 0 ? 'Top' : 'Bottom';
        else if (ay >= ax && ay >= az && ay > eps) role = dy > 0 ? 'Front' : 'Back';
        else if (ax >= ay && ax >= az && ax > eps) role = dx > 0 ? 'Right' : 'Left';
        if (role) attachName(named, face, panelFaceNames[role]);
        expl.Next();
      }
      expl.delete();
      finalSolid = named;
    } else if (feature.kind === 'imported') {
      if (!lookupImportedShape) {
        cleanupOnError();
        return err({
          kind: 'invalidParameter',
          message: `ImportedFeature ${feature.id}: no lookup function provided to executeTree`,
          correlationId: newCorrelationId(),
          featureId: feature.id
        });
      }
      // Imported feature semantically replaces the running solid (operation:
      // implicit 'new'). Dispose any prior running body before installing
      // the imported one.
      if (finalSolid) {
        disposeShape(finalSolid.shape);
        finalSolid = null;
      }
      try {
        finalSolid = executeImportedFeature(oc, feature, lookupImportedShape);
      } catch (e) {
        cleanupOnError();
        return err({
          kind: 'invalidGeometry',
          message: `ImportedFeature ${feature.id}: ${(e as Error).message}`,
          correlationId: newCorrelationId(),
          featureId: feature.id
        });
      }
    } else if (feature.kind === 'hardware') {
      // §13.1-B1: build a fully-centered box via the two-corner form.
      // BRepPrimAPI_MakeBox_4(p1, p2) spans [p1, p2] — no corner-at-origin offset.
      // MUST NOT use makeBox() (uses BRepPrimAPI_MakeBox_2, corner at origin — wrong centering).
      const { l, w, h } = feature.bboxMm;
      const p1 = new oc.gp_Pnt_3(-l / 2, -w / 2, -h / 2);
      const p2 = new oc.gp_Pnt_3( l / 2,  w / 2,  h / 2);
      const rawBoxShape = new oc.BRepPrimAPI_MakeBox_4(p1, p2).Shape();
      p1.delete();
      p2.delete();
      if (finalSolid) {
        disposeShape(finalSolid.shape);
      }
      finalSolid = {
        shape: { __brand: 'OcctShape' as const, handle: rawBoxShape } as OcctShape,
        faceNames: [],
      };
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

  // Choose UV projection: panel → grain-aligned planar; everything else → box.
  // Origin features (workAxis, workPlane, workPoint) are skipped.
  const firstUserFeature = part.featureTree.find(
    (f) => f.kind !== 'workAxis' && f.kind !== 'workPlane' && f.kind !== 'workPoint',
  );
  const uvProjection: UvProjection = firstUserFeature?.kind === 'panel'
    ? panelUvProjection(firstUserFeature)
    : { mode: 'box' };

  const mesh = tessellate(oc, finalSolid.shape, {
    linearDeflection: adaptiveLinearDeflection(computeBoundingBox(oc, finalSolid.shape)),
  }, uvProjection);
  const tessellatedEdges = tessellateEdges(oc, finalSolid);
  const tessellatedFaces = tessellateFaces(oc, finalSolid);
  // API compatibility: `ExecutionResult.finalSolid` is OcctShape (the raw
  // handle wrapper). Callers dispose it via `disposeShape`; they don't need
  // the NamedShape metadata here. The name map stays inside the executor,
  // except for `tessellatedEdges` which carries a pre-resolved (edgeName →
  // world-space segments) view so the app-layer edge picker does not need
  // to reason about BRep topology.

  const workFeatures = Array.from(workFeatureCache.values());

  return ok({
    mesh,
    finalSolid: finalSolid.shape,
    namedShape: finalSolid,
    tessellatedEdges,
    faceNames: finalSolid.faceNames.map((f) => f.name),
    tessellatedFaces,
    ...(featureErrors.size > 0 ? { featureErrors } : {}),
    workFeatures,
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

