import type { AssemblyConstraint, ParamOrLiteral } from '@zilventor/shared';

/**
 * Returns the parameter-bearing fields of a constraint by kind.
 * Used by the parameterRegistry subscriber to detect when a constraint
 * references a named parameter (and therefore the solver should re-run
 * when that parameter changes).
 *
 * - mate / flush / insert → [offset]
 * - angle                → [angle]
 * - tangent              → [radius?, r1?, r2?] (only defined fields)
 * - coincident (never persisted — mapped to mate) → not a separate kind
 */
export function paramRefValuesOf(c: AssemblyConstraint): ParamOrLiteral[] {
  switch (c.kind) {
    case 'mate':
    case 'flush':
    case 'insert':
      return [c.offset];
    case 'angle':
      return [c.angle];
    case 'tangent': {
      const refs: ParamOrLiteral[] = [];
      if (c.radius !== undefined) refs.push(c.radius);
      if (c.r1 !== undefined) refs.push(c.r1);
      if (c.r2 !== undefined) refs.push(c.r2);
      return refs;
    }
    default: {
      // exhaustiveness guard — TypeScript will catch unhandled variants
      const _: never = c;
      return [];
    }
  }
}
