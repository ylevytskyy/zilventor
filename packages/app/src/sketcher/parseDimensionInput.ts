import { Parser } from 'expr-eval';
import type { DimensionConstraint } from '@zilventor/shared';

export type ParseResult =
  | { ok: true; value: number }
  | { ok: false; reason?: 'param-ref' };

/** Kinds where a ≤0 value is physically invalid. */
const POSITIVE_ONLY_KINDS: ReadonlySet<DimensionConstraint['kind']> = new Set([
  'dim-length',
  'dim-radius',
  'dim-diameter',
]);

const _parser = new Parser();

/**
 * Parse and validate a user-typed string for a dimension constraint.
 *
 * Rules:
 *  - Empty → `{ ok: false }`.
 *  - Contains variable references (e.g. `width-18`) → `{ ok: false, reason: 'param-ref' }`.
 *  - Constant arithmetic (`100/2`, `2*30+5`) → evaluates and validates like a plain number.
 *  - `dim-length`, `dim-radius`, `dim-diameter`: reject evaluated value ≤ 0.
 *  - `dim-angle`: return the degree value AS-IS. GcsSystem.ts:593 already converts
 *    degrees → radians internally when feeding the solver, so stored values are degrees.
 *    Do NOT convert here.
 *  - `dim-distance`, `dim-point-line-distance`: accept any finite number.
 */
export function parseDimensionInput(
  kind: DimensionConstraint['kind'],
  raw: string
): ParseResult {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false };

  let expr;
  try {
    expr = _parser.parse(trimmed);
  } catch {
    return { ok: false };
  }

  // If the expression references any variables it's a param-ref — reject with hint.
  if (expr.variables().length > 0) return { ok: false, reason: 'param-ref' };

  let n: number;
  try {
    n = expr.evaluate({});
  } catch {
    return { ok: false };
  }
  if (!isFinite(n) || isNaN(n)) return { ok: false };

  if (POSITIVE_ONLY_KINDS.has(kind) && n <= 0) return { ok: false };

  // dim-angle: stored in degrees — return as-is (NO deg→rad conversion).
  return { ok: true, value: n };
}
