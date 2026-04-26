import { describe, it, expect } from 'vitest';
import { choleskySolve } from '../linalg';

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
