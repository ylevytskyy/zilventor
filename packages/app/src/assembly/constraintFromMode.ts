import type { AssemblyConstraint, AssemblyConstraintRef, ParamOrLiteral } from '@zilventor/shared';

export type ConstraintMode = 'mate' | 'flush' | 'angle' | 'insert' | 'coincident';

export interface BuildAssemblyConstraintArgs {
  id: string;
  mode: ConstraintMode;
  refA: AssemblyConstraintRef | { componentPath: import('@zilventor/shared').ComponentPath; circularEdge: import('@zilventor/shared').EdgeName };
  refB: AssemblyConstraintRef | { componentPath: import('@zilventor/shared').ComponentPath; circularEdge: import('@zilventor/shared').EdgeName };
  offset: ParamOrLiteral;
  angle: ParamOrLiteral;
}

/**
 * Pure function that maps a dialog mode + picked refs + offset/angle inputs to
 * an AssemblyConstraint ready for persistence. 'coincident' maps to kind='mate'
 * with a locked offset literal of 0 — it is NOT persisted as a new constraint kind.
 */
export function buildAssemblyConstraint(args: BuildAssemblyConstraintArgs): AssemblyConstraint {
  const { id, mode, refA, refB, offset, angle } = args;

  if (mode === 'insert') {
    return {
      id,
      kind: 'insert',
      refA: refA as { componentPath: import('@zilventor/shared').ComponentPath; circularEdge: import('@zilventor/shared').EdgeName },
      refB: refB as { componentPath: import('@zilventor/shared').ComponentPath; circularEdge: import('@zilventor/shared').EdgeName },
      offset,
      suppressed: false,
    };
  }

  if (mode === 'angle') {
    return {
      id,
      kind: 'angle',
      refA: refA as AssemblyConstraintRef,
      refB: refB as AssemblyConstraintRef,
      angle,
      suppressed: false,
    };
  }

  if (mode === 'coincident') {
    // Coincident = mate at offset 0, locked. Persisted as mate (no new kind).
    return {
      id,
      kind: 'mate',
      refA: refA as AssemblyConstraintRef,
      refB: refB as AssemblyConstraintRef,
      offset: { kind: 'literal', value: 0 },
      suppressed: false,
    };
  }

  // mode is 'mate' | 'flush'
  return {
    id,
    kind: mode,
    refA: refA as AssemblyConstraintRef,
    refB: refB as AssemblyConstraintRef,
    offset,
    suppressed: false,
  };
}
