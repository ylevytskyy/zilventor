/**
 * Solve A x = b for symmetric positive-definite A via Cholesky factorization.
 * Throws if A is not SPD (a diagonal element of L is non-positive).
 */
export function choleskySolve(A: number[][], b: number[]): number[] {
  const n = A.length;
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i]![j]!;
      for (let k = 0; k < j; k++) s -= L[i]![k]! * L[j]![k]!;
      if (i === j) {
        if (s <= 0) throw new Error(`choleskySolve: matrix not SPD at i=${i}, s=${s}`);
        L[i]![i] = Math.sqrt(s);
      } else {
        L[i]![j] = s / L[j]![j]!;
      }
    }
  }
  // Forward solve L y = b
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i]!;
    for (let k = 0; k < i; k++) s -= L[i]![k]! * y[k]!;
    y[i] = s / L[i]![i]!;
  }
  // Back solve L^T x = y
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]!;
    for (let k = i + 1; k < n; k++) s -= L[k]![i]! * x[k]!;
    x[i] = s / L[i]![i]!;
  }
  return x;
}

/**
 * Jacobi-SVD for an m×n matrix (m ≥ n). Returns U (m×n), s (n), V (n×n).
 * One-sided Jacobi rotations on V; standard implementation.
 * `mat` is modified in place during factorization.
 */
export function jacobiSVD(mat: number[][]): { U: number[][]; s: number[]; V: number[][] } {
  const m = mat.length;
  const n = mat[0]!.length;
  if (m < n) throw new Error('jacobiSVD: requires m >= n');
  const a = mat.map((r) => r.slice());
  const V: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  const tol = 1e-14;
  const maxSweeps = 50;
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        let alpha = 0, beta = 0, gamma = 0;
        for (let i = 0; i < m; i++) {
          alpha += a[i]![p]! * a[i]![p]!;
          beta  += a[i]![q]! * a[i]![q]!;
          gamma += a[i]![p]! * a[i]![q]!;
        }
        off += gamma * gamma;
        if (Math.abs(gamma) < tol * Math.sqrt(alpha * beta + 1e-300)) continue;
        const zeta = (beta - alpha) / (2 * gamma);
        const t = Math.sign(zeta) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = c * t;
        for (let i = 0; i < m; i++) {
          const ap = a[i]![p]!, aq = a[i]![q]!;
          a[i]![p] = c * ap - s * aq;
          a[i]![q] = s * ap + c * aq;
        }
        for (let i = 0; i < n; i++) {
          const vp = V[i]![p]!, vq = V[i]![q]!;
          V[i]![p] = c * vp - s * vq;
          V[i]![q] = s * vp + c * vq;
        }
      }
    }
    if (off < tol) break;
  }
  const s = new Array(n).fill(0);
  const U: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let j = 0; j < n; j++) {
    let norm = 0;
    for (let i = 0; i < m; i++) norm += a[i]![j]! * a[i]![j]!;
    norm = Math.sqrt(norm);
    s[j] = norm;
    if (norm > 1e-300) {
      for (let i = 0; i < m; i++) U[i]![j] = a[i]![j]! / norm;
    }
  }
  return { U, s, V };
}
