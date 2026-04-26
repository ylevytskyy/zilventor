import { describe, it, expect } from 'vitest';
import { choleskySolve } from '../linalg';
import { jacobiSVD } from '../linalg';
import { projectOntoBasis } from '../linalg';

function makeRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) | 0;
    return ((state >>> 0) / 4294967296) - 0.5;
  };
}

describe('choleskySolve', () => {
  it('solves a 2x2 SPD system', () => {
    // A = [[4,1],[1,3]]; b = [1, 2]; expected x ≈ [(4*1-1*2)/(4*3-1*1), ...]
    const A = [[4, 1], [1, 3]];
    const b = [1, 2];
    const x = choleskySolve(A, b);
    // Solve by hand: x1 = (1*3 - 1*2) / (4*3 - 1*1) = 1/11; x2 = (4*2 - 1*1)/11 = 7/11
    expect(x[0]).toBeCloseTo(1 / 11, 9);
    expect(x[1]).toBeCloseTo(7 / 11, 9);
  });
  it('solves a 5x5 random SPD system to 1e-9', () => {
    // Build A = M^T M + I (guaranteed SPD)
    const n = 5;
    const rand = makeRng(42);
    const M = Array.from({ length: n }, () => Array.from({ length: n }, () => rand()));
    const A = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => {
        let s = i === j ? 1 : 0;
        for (let k = 0; k < n; k++) s += M[k]![i]! * M[k]![j]!;
        return s;
      }));
    const xTrue = [1, -2, 3, -4, 5];
    const b = A.map((row) => row.reduce((s, v, j) => s + v * xTrue[j]!, 0));
    const x = choleskySolve(A, b);
    for (let i = 0; i < n; i++) expect(x[i]!).toBeCloseTo(xTrue[i]!, 9);
  });
  it('throws on a non-SPD matrix (indefinite)', () => {
    // [[1, 2], [2, 1]] is symmetric but indefinite (eigenvalues 3 and -1)
    // Cholesky should fail at i=1 because s = 1 - 2*2 = -3 < 0.
    const A = [[1, 2], [2, 1]];
    const b = [1, 1];
    expect(() => choleskySolve(A, b)).toThrow(/not SPD/);
  });
  it('throws on a zero-diagonal matrix (singular)', () => {
    const A = [[0, 0], [0, 1]];
    const b = [1, 1];
    expect(() => choleskySolve(A, b)).toThrow(/not SPD/);
  });
});

describe('jacobiSVD', () => {
  function reconstruct(U: number[][], s: number[], V: number[][]): number[][] {
    const m = U.length, n = V.length;
    const out = Array.from({ length: m }, () => new Array(n).fill(0));
    for (let i = 0; i < m; i++)
      for (let j = 0; j < n; j++)
        for (let k = 0; k < s.length; k++)
          out[i]![j] += U[i]![k]! * s[k]! * V[j]![k]!;
    return out;
  }
  it('round-trips a 3x3 matrix to 1e-10', () => {
    const A = [[1, 2, 3], [2, 1, 0], [0, 1, 4]];
    const { U, s, V } = jacobiSVD(A.map((r) => r.slice()));
    const R = reconstruct(U, s, V);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        expect(R[i]![j]).toBeCloseTo(A[i]![j]!, 10);
  });
  it('detects rank-deficiency with a near-zero singular value', () => {
    // Rank-1 matrix: column 1 is 2x column 0
    const A = [[1, 2], [3, 6], [5, 10]];
    const { s } = jacobiSVD(A.map((r) => r.slice()));
    // With sorted output, s[0] is the dominant singular, s[1] is the small one.
    expect(s[0]).toBeGreaterThan(0);
    expect(s[1]).toBeLessThan(s[0]! * 1e-12);
  });
  it('returns V as the right-singular vectors', () => {
    const A = [[3, 0], [0, 1]];
    const { s, V } = jacobiSVD(A);
    expect(s[0]).toBeCloseTo(3, 9);
    expect(s[1]).toBeCloseTo(1, 9);
    // V columns should be standard basis (up to sign) since A is diagonal
    expect(Math.abs(V[0]![0]!)).toBeCloseTo(1, 9);
    expect(Math.abs(V[1]![1]!)).toBeCloseTo(1, 9);
  });
});

describe('projectOntoBasis', () => {
  it('projects vector onto orthonormal column basis', () => {
    // Basis: e1 only (col 0 of identity). Vector = [3, 4]. Projection = [3, 0].
    const basis = [[1], [0]];  // 2x1
    const v = [3, 4];
    const out = projectOntoBasis(v, basis);
    expect(out).toEqual([3, 0]);
  });
  it('returns zero vector when basis is empty', () => {
    const out = projectOntoBasis([1, 2, 3], []);
    expect(out).toEqual([0, 0, 0]);
  });
  it('handles 2-column basis', () => {
    // Basis spans the e1+e2 plane in R^3; vector = [1,1,5] → proj = [1,1,0]
    const basis = [[1, 0], [0, 1], [0, 0]];
    const out = projectOntoBasis([1, 1, 5], basis);
    expect(out[0]).toBeCloseTo(1, 12);
    expect(out[1]).toBeCloseTo(1, 12);
    expect(out[2]).toBeCloseTo(0, 12);
  });
});
