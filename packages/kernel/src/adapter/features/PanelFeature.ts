import type { PanelFeature, ParamOrLiteral } from '@zilventor/shared';
import type { OcctInstance } from '../../occt/occtLoader';
import { buildPanelBox, type PanelBoxResult } from '../../occt/PanelOps';

/**
 * Context for evaluating a `PanelFeature`.
 *
 * - `parameters`   — current parameter values keyed by name. Mirrors the
 *                    test's shape ({ value, expression, units }) so that the
 *                    PanelFeature evaluator can be exercised independently of
 *                    the broader PartDocument's `SketchParameter` shape. The
 *                    FeatureTree dispatch (T10) adapts `part.parameters`
 *                    into this shape.
 * - `featureIndex` — index of this panel in the user-visible feature tree.
 *                    The PanelFeature MUST be the first user feature
 *                    (`featureIndex === 0`); any non-zero value triggers
 *                    PANEL_NOT_BASE_FEATURE. Omitting `featureIndex` skips
 *                    the guard (so the helper can be unit-tested in
 *                    isolation, like other feature evaluators).
 */
export interface EvaluatePanelCtx {
  parameters: Record<string, { value: number; expression: string; units: string }>;
  featureIndex?: number;
}

/**
 * Result of evaluating a `PanelFeature`. When `suppressed` is true the
 * feature is skipped (`skipped: true`, no shape/bbox); otherwise the four
 * geometry fields are populated and identical to `buildPanelBox`'s output.
 *
 * Lifecycle: the caller (FeatureTree) owns `shape` and disposes it via the
 * usual `disposeShape` helper. Names in `faceNames`/`edgeNames` are plain
 * data and need no disposal.
 */
export interface PanelEvalResult {
  shape?: unknown;
  bbox?: [number, number, number, number, number, number];
  faceNames?: PanelBoxResult['faceNames'];
  edgeNames?: PanelBoxResult['edgeNames'];
  skipped?: boolean;
}

/**
 * Evaluate a `PanelFeature` into an OCCT box plus canonical face/edge names.
 *
 * Invariants enforced here:
 *   - PANEL_NOT_BASE_FEATURE: the panel must be the first user feature in
 *     the part. The FeatureTree dispatch passes `featureIndex` (the position
 *     of this feature among user features, ignoring origins); a non-zero
 *     value short-circuits with a PANEL_NOT_BASE_FEATURE error. Calls that
 *     omit `featureIndex` (i.e. unit tests) skip this guard.
 *   - Suppressed panels return `{ skipped: true }` and produce no body.
 *   - L/W/T must resolve to positive numbers; non-positive values throw via
 *     `buildPanelBox`'s own guard ("must be positive").
 *
 * The actual geometry build (panel box centred on origin in X/Y, bottom on
 * Z=0, six canonically-named faces and four top-rim edges) lives in
 * `buildPanelBox`; this function is just the thin parameter-resolution +
 * invariant-check wrapper that the FeatureTree dispatch can call.
 */
export function evaluatePanel(
  occt: OcctInstance,
  feature: PanelFeature,
  ctx: EvaluatePanelCtx,
): PanelEvalResult {
  if (ctx.featureIndex != null && ctx.featureIndex !== 0) {
    throw new Error(
      `PANEL_NOT_BASE_FEATURE: panel feature ${feature.id} at index ${ctx.featureIndex} (must be 0)`,
    );
  }
  if (feature.suppressed) return { skipped: true };

  const length = resolveParamOrLiteral(feature.length, ctx.parameters, 'length');
  const width = resolveParamOrLiteral(feature.width, ctx.parameters, 'width');
  const thickness = resolveParamOrLiteral(feature.thickness, ctx.parameters, 'thickness');

  const r = buildPanelBox(occt, { length, width, thickness });
  return { shape: r.shape, bbox: r.bbox, faceNames: r.faceNames, edgeNames: r.edgeNames };
}

/**
 * Resolve a `ParamOrLiteral` into a raw numeric value against the supplied
 * parameter map. Unknown parameter names throw — the panel evaluator runs
 * after parameters have been collected, so a missing reference is a hard
 * error, not a soft skip.
 */
function resolveParamOrLiteral(
  v: ParamOrLiteral,
  parameters: EvaluatePanelCtx['parameters'],
  field: string,
): number {
  if (v.kind === 'literal') return v.value;
  const p = parameters[v.paramName];
  if (!p) {
    throw new Error(`Panel ${field}: parameter "${v.paramName}" not found`);
  }
  return p.value;
}
