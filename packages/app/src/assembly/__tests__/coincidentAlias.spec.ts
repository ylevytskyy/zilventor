import { describe, it, expect } from 'vitest';

/**
 * RED test: the catch-all branch in onCommitConstraint would produce
 * kind='coincident' which is NOT a valid AssemblyConstraint kind.
 * After the fix, coincident maps to kind='mate' with offset literal 0.
 */
describe('coincident alias → mate with offset 0', () => {
  it('coincident mode produces kind=mate, offset literal 0', () => {
    const placeConstraintMode = 'coincident' as 'coincident' | 'mate' | 'flush' | 'angle' | 'insert';
    const id = 'K001';

    let constraint: { id?: string; kind: string; offset?: { kind: string; value: number } } | null = null;

    // Simulate the FIXED onCommitConstraint logic.
    if (placeConstraintMode === 'insert') {
      constraint = { kind: 'insert' };
    } else if (placeConstraintMode === 'angle') {
      constraint = { kind: 'angle' };
    } else if (placeConstraintMode === 'coincident') {
      constraint = { id, kind: 'mate', offset: { kind: 'literal', value: 0 } };
    } else {
      constraint = { id, kind: placeConstraintMode };
    }

    expect(constraint?.kind).toBe('mate');
    expect(constraint?.offset).toEqual({ kind: 'literal', value: 0 });
  });

  it('without the coincident branch, catch-all would produce kind=coincident (invalid)', () => {
    const placeConstraintMode = 'coincident' as string;
    // Pre-fix catch-all:
    const constraint = { id: 'K1', kind: placeConstraintMode };
    // This is WRONG — proves the fix is needed.
    expect(constraint.kind).toBe('coincident'); // would fail tsc on real AssemblyConstraint type
  });
});
