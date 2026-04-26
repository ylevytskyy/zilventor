import { describe, it, expect } from 'vitest';
import { buildAllResiduals, buildAllJacobian, lmSolve, type SolverInput } from '../AssemblyConstraintSolver';
import { quatFromEulerXYZ } from '../quat';

const trivialPlane = { kind: 'plane' as const, P: { x: 0, y: 0, z: 0 }, N: { x: 0, y: 0, z: 1 } };

describe('buildAllResiduals / buildAllJacobian', () => {
  it('returns 3 residuals for a single mate face↔face + soft-norm rows', () => {
    const input: SolverInput = {
      components: [
        { id: 'A', T: { x: 0, y: 0, z: 0 }, q: [0, 0, 0, 1] },
        { id: 'B', T: { x: 0, y: 0, z: 5 }, q: [0, 0, 0, 1] },
      ],
      grounded: new Set(['A']),
      constraints: [{
        id: 'k1', kind: 'mate', suppressed: false,
        refA: { kind: 'face', componentId: 'A', face: { featureId: 'a', role: 'r' } } as any,
        refB: { kind: 'face', componentId: 'B', face: { featureId: 'b', role: 'r' } } as any,
        offset: { kind: 'literal', value: 0 } as any,
      }],
      resolvedRefs: new Map<string, any>([
        ['k1#A', trivialPlane],
        ['k1#B', trivialPlane],
      ]),
      paramValues: {},
    };
    const x = [0, 0, 5, 0, 0, 0, 1];  // B has 7 unknowns; A is grounded
    const r = buildAllResiduals(input, x);
    expect(r.length).toBe(3 + 1);  // 3 mate residuals + 1 soft-norm for B
    const J = buildAllJacobian(input, x);
    expect(J.length).toBe(4);
    expect(J[0]!.length).toBe(7);  // 7 unknowns since A is grounded
  });
});

describe('lmSolve', () => {
  it('converges 2-component face↔face mate to 1e-5', () => {
    const trivialPlane = { kind: 'plane' as const, P: { x: 0, y: 0, z: 0 }, N: { x: 0, y: 0, z: 1 } };
    const input: SolverInput = {
      components: [
        { id: 'A', T: { x: 0, y: 0, z: 0 }, q: [0, 0, 0, 1] },
        { id: 'B', T: { x: 1, y: 1, z: 5 }, q: quatFromEulerXYZ(10, 5, 0) },
      ],
      grounded: new Set(['A']),
      constraints: [{
        id: 'k1', kind: 'mate', suppressed: false,
        refA: { kind: 'face', componentId: 'A', face: { featureId: 'a', role: 'r' } } as any,
        refB: { kind: 'face', componentId: 'B', face: { featureId: 'b', role: 'r' } } as any,
        offset: { kind: 'literal', value: 0 } as any,
      }],
      resolvedRefs: new Map<string, any>([
        ['k1#A', trivialPlane],
        ['k1#B', trivialPlane],
      ]),
      paramValues: {},
    };
    // Initial x: B's pose
    const x0 = [1, 1, 5, ...quatFromEulerXYZ(10, 5, 0)];
    const result = lmSolve(input, x0);
    expect(result.converged).toBe(true);
    // After convergence, the constraint residuals (first N rows, before soft-norm) should be small
    // Mate face-face is 3 residuals, then 1 soft-norm row for B
    for (let i = 0; i < 3; i++)
      expect(Math.abs(result.finalResiduals[i]!)).toBeLessThan(1e-3);
  });

  it('handles trivial all-grounded case (no unknowns)', () => {
    const input: SolverInput = {
      components: [
        { id: 'A', T: { x: 0, y: 0, z: 0 }, q: [0, 0, 0, 1] },
      ],
      grounded: new Set(['A']),
      constraints: [],
      resolvedRefs: new Map(),
      paramValues: {},
    };
    const result = lmSolve(input, []);
    expect(result.converged).toBe(true);
    expect(result.x).toEqual([]);
  });
});
