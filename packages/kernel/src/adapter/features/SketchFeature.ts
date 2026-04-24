import type { OcctInstance } from '../../occt/occtLoader';
import {
  ok,
  err,
  type Result,
  type KernelError,
  newCorrelationId,
  type Feature
} from '@zilventor/shared';
import {
  makeLineEdge,
  makeArcEdge,
  makeCircleEdge,
  makeSplineEdge,
  makeRectangleEdges,
  combineEdgesIntoWires,
  disposeEdge,
  type EdgeHandle,
  type WireHandle
} from '../../occt/SketchOps';
import type { NamedShape } from '../../occt/FaceNaming';

/**
 * The adapter-level result of executing a sketch feature. `wire` owns
 * the OCCT topology; callers must hand it to `disposeSketchResult` once
 * the downstream consumer (e.g. ExtrudeFeature) is done with it.
 */
export type SketchResult = {
  sketchId: string;
  wire: WireHandle;
  plane: 'XY' | 'XZ' | 'YZ';
  closed: boolean;
  /** Placeholder NamedShape that downstream features (extrude/revolve) will
   *  attach faces to. Sketches themselves produce only edges/wires; the
   *  naming becomes meaningful once a solid is generated. `shape` here is
   *  a degenerate wrapper — downstream code should read `named.faceNames`,
   *  not `named.shape`. */
  named: NamedShape;
};

/**
 * Translates a domain `sketch` feature into a single closed OCCT wire.
 *
 * Sub-project 2a contract:
 *   - Accepts any combination of line / rectangle / circle / arc / spline primitives.
 *   - Plane must be `XY`.
 *   - The primitives, after stitching via `combineEdgesIntoWires`, must form
 *     exactly one closed wire with no leftover open chains.
 *
 * Violations yield typed KernelErrors (either `invalidParameter` for the
 * plane restriction or `degenerateSketch` with a diagnostic message the UI
 * can surface to the user) rather than throws.
 */
export function executeSketchFeature(
  oc: OcctInstance,
  feature: Extract<Feature, { kind: 'sketch' }>
): Result<SketchResult, KernelError> {
  if (feature.plane !== 'XY') {
    return err({
      kind: 'invalidParameter',
      message: 'Sub-project 2a only supports the XY sketch plane.',
      correlationId: newCorrelationId(),
      featureId: feature.id
    });
  }
  if (feature.primitives.length === 0) {
    return err({
      kind: 'degenerateSketch',
      message: 'Sketch is empty — cannot extrude. Draw a closed profile first.',
      correlationId: newCorrelationId(),
      featureId: feature.id
    });
  }

  const edges: EdgeHandle[] = [];
  try {
    for (const p of feature.primitives) {
      switch (p.kind) {
        case 'line':
          edges.push(makeLineEdge(oc, { x: p.x1, y: p.y1 }, { x: p.x2, y: p.y2 }));
          break;
        case 'rectangle':
          edges.push(...makeRectangleEdges(oc, p));
          break;
        case 'circle':
          edges.push(makeCircleEdge(oc, p));
          break;
        case 'arc':
          edges.push(makeArcEdge(oc, p));
          break;
        case 'spline':
          edges.push(makeSplineEdge(oc, p));
          break;
      }
    }

    const { closedWires, openChains } = combineEdgesIntoWires(oc, edges);

    if (closedWires.length === 1 && openChains.length === 0) {
      return ok({
        sketchId: feature.id,
        wire: closedWires[0]!,
        plane: feature.plane,
        closed: true,
        named: { shape: { __brand: 'OcctShape', handle: null }, faceNames: [] }
      });
    }

    // Error path — dispose any closed wires we aren't returning.
    closedWires.forEach((w) => (w.wire as { delete?: () => void }).delete?.());

    let message: string;
    if (closedWires.length === 0 && openChains.length >= 1) {
      message = 'Sketch is not closed — cannot extrude. Check that all endpoints connect.';
    } else if (closedWires.length === 0 && openChains.length === 0) {
      message = 'Sketch is empty — cannot extrude. Draw a closed profile first.';
    } else if (closedWires.length >= 2 && openChains.length === 0) {
      message =
        'Sketch has multiple closed loops — cannot extrude. Merge or delete loops so exactly one remains. (Hole support comes in Sub-project 3.)';
    } else {
      message =
        'Sketch has a valid loop plus disconnected line(s). Delete the stray lines or connect them.';
    }
    return err({
      kind: 'degenerateSketch',
      message,
      correlationId: newCorrelationId(),
      featureId: feature.id
    });
  } finally {
    edges.forEach(disposeEdge);
  }
}

/**
 * Releases the OCCT topology owned by a SketchResult. Safe to call
 * once; double-dispose is undefined.
 */
export function disposeSketchResult(_oc: OcctInstance, result: SketchResult): void {
  (result.wire.wire as { delete?: () => void }).delete?.();
}
