import type { DimensionConstraint } from '@zilventor/shared';

export type ParseResult =
  | { ok: true; value: number }
  | { ok: false };

/** Kinds where a ≤0 value is physically invalid. */
const POSITIVE_ONLY_KINDS: ReadonlySet<DimensionConstraint['kind']> = new Set([
  'dim-length',
  'dim-radius',
  'dim-diameter',
]);

/**
 * Parse and validate a user-typed plain-number string for a dimension constraint.
 *
 * Rules:
 *  - Empty / NaN → `{ ok: false }`.
 *  - `dim-length`, `dim-radius`, `dim-diameter`: reject ≤ 0.
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
  const n = Number(trimmed);
  if (!isFinite(n) || isNaN(n)) return { ok: false };

  if (POSITIVE_ONLY_KINDS.has(kind) && n <= 0) return { ok: false };

  // dim-angle: stored in degrees — return as-is (NO deg→rad conversion).
  return { ok: true, value: n };
}
