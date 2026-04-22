import type { OcctInstance } from '../../occt/occtLoader';
import {
  makeRectangleWireXY,
  disposeWire,
  type WireHandle
} from '../../occt/SketchOps';
import {
  ok,
  err,
  type Result,
  type KernelError,
  newCorrelationId,
  type Feature
} from '@zilventor/shared';

/**
 * The adapter-level result of executing a sketch feature. `wire` owns
 * the OCCT topology; callers must hand it to `disposeSketchResult` once
 * the downstream consumer (e.g. ExtrudeFeature) is done with it.
 */
export type SketchResult = {
  sketchId: string;
  wire: WireHandle;
  plane: 'XY' | 'XZ' | 'YZ';
  edgeCount: number;
  closed: boolean;
};

/**
 * Translates a domain `sketch` feature into a closed OCCT wire.
 *
 * Shell MVP contract:
 *   - Exactly one primitive, of kind `rectangle`.
 *   - Plane must be `XY`.
 * Violations yield typed KernelErrors rather than throws so the worker
 * can route them to the UI diagnostics channel.
 */
export function executeSketchFeature(
  oc: OcctInstance,
  feature: Extract<Feature, { kind: 'sketch' }>
): Result<SketchResult, KernelError> {
  const first = feature.primitives[0];
  if (feature.primitives.length !== 1 || !first || first.kind !== 'rectangle') {
    return err({
      kind: 'degenerateSketch',
      message: 'Shell MVP supports exactly one rectangle per sketch',
      correlationId: newCorrelationId(),
      featureId: feature.id
    });
  }
  if (feature.plane !== 'XY') {
    return err({
      kind: 'invalidParameter',
      message: 'Shell MVP only supports the XY sketch plane',
      correlationId: newCorrelationId(),
      featureId: feature.id
    });
  }
  const wire = makeRectangleWireXY(oc, first.x, first.y, first.w, first.h);
  return ok({
    sketchId: feature.id,
    wire,
    plane: feature.plane,
    edgeCount: 4,
    closed: true
  });
}

/**
 * Releases the OCCT topology owned by a SketchResult. Safe to call
 * once; double-dispose is undefined.
 */
export function disposeSketchResult(_oc: OcctInstance, result: SketchResult): void {
  disposeWire(result.wire);
}
