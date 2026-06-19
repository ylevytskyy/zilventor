import { Parser } from 'expr-eval';

/** Math functions a rule expression may call. Mirrors ParameterRegistry's whitelist. */
const MATH_FNS = ['min', 'max', 'abs', 'sqrt', 'floor', 'ceil', 'round'] as const;

/**
 * Reserved identifiers that are part of the expression language itself
 * (logical operators, the `if` builtin, boolean literals) rather than
 * snapshot variables. expr-eval handles these natively, but the raw
 * identifier scan below would otherwise flag them as unknown.
 */
const RESERVED = new Set<string>(['if', 'and', 'or', 'not', 'true', 'false']);

/** Maximum number of `if()` calls permitted in a single rule expression. */
const MAX_IF_DEPTH = 5;

/** Base error for any failure while evaluating a rule expression. */
export class RuleEvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleEvalError';
  }
}

/** Thrown when a rule expression nests more `if()` calls than allowed. */
export class RuleDepthError extends RuleEvalError {
  constructor(message: string) {
    super(message);
    this.name = 'RuleDepthError';
  }
}

const parser = new Parser();

/**
 * Evaluates a single rule expression against a snapshot of parameter values.
 *
 * Supports comparisons (`> < >= <= == !=`), logical `and/or/not`, the `if(c,a,b)`
 * conditional, and the whitelisted math functions. Throws `RuleEvalError` on a
 * parse failure or unknown identifier, and `RuleDepthError` when the expression
 * exceeds `MAX_IF_DEPTH` `if()` calls. Returns the raw result (number or boolean).
 */
export function evaluateRule(
  expression: string,
  snapshot: Record<string, number>
): number | boolean {
  // Conservative guard against pathological rule expressions: cap the total
  // number of `if()` calls (a superset of nesting depth).
  const ifCount = (expression.match(/\bif\b/g) ?? []).length;
  if (ifCount > MAX_IF_DEPTH) {
    throw new RuleDepthError(`rule expression exceeds ${MAX_IF_DEPTH} if() calls`);
  }

  let expr;
  try {
    expr = parser.parse(expression);
  } catch (e) {
    throw new RuleEvalError(`parse error: ${(e as Error).message}`);
  }

  // Reject any identifier that is neither a snapshot variable, an allowed math
  // function, nor a reserved language keyword. Mirrors ParameterRegistry's raw
  // scan so silently-resolved builtins (e.g. `sin`) are caught.
  const idents = expression.match(/[A-Za-z_][A-Za-z_0-9]*/g) ?? [];
  for (const ident of idents) {
    if (RESERVED.has(ident)) continue;
    if ((MATH_FNS as readonly string[]).includes(ident)) continue;
    if (Object.prototype.hasOwnProperty.call(snapshot, ident)) continue;
    throw new RuleEvalError(`unknown identifier: ${ident}`);
  }

  const context: Record<string, unknown> = { ...snapshot };
  for (const fn of MATH_FNS) context[fn] = Math[fn];

  try {
    return expr.evaluate(context as Record<string, number>) as number | boolean;
  } catch (e) {
    throw new RuleEvalError(`evaluation error: ${(e as Error).message}`);
  }
}
