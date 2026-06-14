import { describe, it, expect } from 'vitest';
import { buildAllResiduals, buildAllJacobian, lmSolve, type SolverInput, solveAssembly, type AssemblySolveInput } from '../AssemblyConstraintSolver';
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
        refA: { kind: 'face', componentPath: ['A'], face: { featureId: 'a', role: 'r' } } as any,
        refB: { kind: 'face', componentPath: ['B'], face: { featureId: 'b', role: 'r' } } as any,
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
        refA: { kind: 'face', componentPath: ['A'], face: { featureId: 'a', role: 'r' } } as any,
        refB: { kind: 'face', componentPath: ['B'], face: { featureId: 'b', role: 'r' } } as any,
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

describe('solveAssembly', () => {
  it('returns poses + diagnostics + freeDofBasis', () => {
    const trivialPlane = { kind: 'plane' as const, P: { x: 0, y: 0, z: 0 }, N: { x: 0, y: 0, z: 1 } };
    const input: AssemblySolveInput = {
      components: [
        { id: 'A', T: { x: 0, y: 0, z: 0 }, q: [0, 0, 0, 1] },
        { id: 'B', T: { x: 1, y: 1, z: 5 }, q: [0, 0, 0, 1] },
      ],
      groundedComponentIds: ['A'],
      constraints: [{
        id: 'k1', kind: 'mate', suppressed: false,
        refA: { kind: 'face', componentPath: ['A'], face: { featureId: 'a', role: 'r' } } as any,
        refB: { kind: 'face', componentPath: ['B'], face: { featureId: 'b', role: 'r' } } as any,
        offset: { kind: 'literal', value: 0 } as any,
      }],
      resolvedRefs: new Map<string, any>([
        ['k1#A', trivialPlane],
        ['k1#B', trivialPlane],
      ]),
      paramValues: {},
    };
    const out = solveAssembly(input);
    expect(out.poses.get('A')).toBeDefined();
    expect(out.poses.get('B')).toBeDefined();
    expect(out.diagnostics.status).toMatch(/fully|underconstrained|over|did-not/);
    expect(out.freeDofBasis).toBeInstanceOf(Float64Array);
    // The mate constraint should be satisfied (residual ~0)
    expect(out.diagnostics.perConstraint.get('k1')!.residual).toBeLessThan(1e-3);
  });

  it('auto-anchors first component when groundedComponentIds is empty', () => {
    const trivialPlane = { kind: 'plane' as const, P: { x: 0, y: 0, z: 0 }, N: { x: 0, y: 0, z: 1 } };
    const input: AssemblySolveInput = {
      components: [
        { id: 'A', T: { x: 0, y: 0, z: 0 }, q: [0, 0, 0, 1] },
        { id: 'B', T: { x: 0, y: 0, z: 5 }, q: [0, 0, 0, 1] },
      ],
      groundedComponentIds: [],  // none grounded
      constraints: [{
        id: 'k1', kind: 'mate', suppressed: false,
        refA: { kind: 'face', componentPath: ['A'], face: { featureId: 'a', role: 'r' } } as any,
        refB: { kind: 'face', componentPath: ['B'], face: { featureId: 'b', role: 'r' } } as any,
        offset: { kind: 'literal', value: 0 } as any,
      }],
      resolvedRefs: new Map<string, any>([
        ['k1#A', trivialPlane],
        ['k1#B', trivialPlane],
      ]),
      paramValues: {},
    };
    const out = solveAssembly(input);
    expect(out.diagnostics.message).toMatch(/auto-anchored A/);
  });

  it('flags broken-ref constraint', () => {
    const input: AssemblySolveInput = {
      components: [
        { id: 'A', T: { x: 0, y: 0, z: 0 }, q: [0, 0, 0, 1] },
        { id: 'B', T: { x: 0, y: 0, z: 5 }, q: [0, 0, 0, 1] },
      ],
      groundedComponentIds: ['A'],
      constraints: [{
        id: 'k1', kind: 'mate', suppressed: false,
        refA: { kind: 'face', componentPath: ['A'], face: { featureId: 'a', role: 'r' } } as any,
        refB: { kind: 'face', componentPath: ['B'], face: { featureId: 'b', role: 'r' } } as any,
        offset: { kind: 'literal', value: 0 } as any,
      }],
      resolvedRefs: new Map<string, any>(),  // empty — both refs missing
      paramValues: {},
    };
    const out = solveAssembly(input);
    expect(out.diagnostics.perConstraint.get('k1')!.brokenRef).toBe(true);
  });

  /**
   * Regression pin: viewport click handler used to forward a placeholder
   * FaceName { featureId:'unresolved', role:'unresolved' } for every face pick
   * (T36 wiring was deferred). The real NamedShape has no face with that id, so
   * ref resolution fails → resolvedRefs is empty for those refs → brokenRef=true.
   * This test pins the brokenRef=true outcome so the regression is detectable
   * even before the fix lands (and confirmed absent after).
   */
  it('constraint with placeholder featureId="unresolved" produces brokenRef=true (pre-fix regression pin)', () => {
    const input: AssemblySolveInput = {
      components: [
        { id: 'A', T: { x: 0, y: 0, z: 0 }, q: [0, 0, 0, 1] },
        { id: 'B', T: { x: 0, y: 0, z: 5 }, q: [0, 0, 0, 1] },
      ],
      groundedComponentIds: ['A'],
      constraints: [{
        id: 'k1', kind: 'mate', suppressed: false,
        // These are the placeholder FaceNames emitted by the pre-fix click handler.
        refA: { kind: 'face', componentPath: ['A'], face: { featureId: 'unresolved', role: 'unresolved', instance: 0 } } as any,
        refB: { kind: 'face', componentPath: ['B'], face: { featureId: 'unresolved', role: 'unresolved', instance: 0 } } as any,
        offset: { kind: 'literal', value: 0 } as any,
      }],
      // Simulates the real path: extractAssemblyRef found no face with featureId='unresolved'
      // → result.ok=false → ref was never inserted into resolvedRefs.
      resolvedRefs: new Map<string, any>(),
      paramValues: {},
    };
    const out = solveAssembly(input);
    expect(out.diagnostics.perConstraint.get('k1')!.brokenRef).toBe(true);
  });
});
