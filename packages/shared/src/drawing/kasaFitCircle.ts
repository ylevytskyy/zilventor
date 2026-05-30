// packages/shared/src/drawing/kasaFitCircle.ts
//
// Exported Kasa algebraic least-squares circle fit.
// Extracted from holeTable.ts (which keeps its private copy for backward compat
// with its own callers). Used by resolveCenterMarkGeometry.ts and any code that
// needs a robust multi-point circle fit.

export type KasaCircleFit = {
  cx: number;
  cy: number;
  r: number;
  /** Root-mean-square radius error (mm). Low = good fit. */
  rms: number;
};

/**
 * Kasa least-squares circle fit over the given 2-D points.
 *
 * Returns null if N < 3 or the linear system is degenerate (collinear points).
 *
 * Unlike the 3-point circumcenter heuristic, this fit is robust against:
 *   - Asymmetric arc fragments (only part of the circle visible)
 *   - Many short near-collinear run-length segments summed together
 *   - Off-axis / off-origin circles
 *
 * @param points  Array of [x, y] tuples in any consistent coordinate space.
 */
export function kasaFitCircle(
  points: ReadonlyArray<readonly [number, number]>,
): KasaCircleFit | null {
  const n = points.length;
  if (n < 3) return null;

  let sumX = 0, sumY = 0;
  for (const [x, y] of points) { sumX += x; sumY += y; }
  const mx = sumX / n;
  const my = sumY / n;

  let Suu = 0, Suv = 0, Svv = 0;
  let Suuu = 0, Suvv = 0, Svvv = 0, Svuu = 0;

  for (const [x, y] of points) {
    const u = x - mx;
    const v = y - my;
    Suu  += u * u;
    Suv  += u * v;
    Svv  += v * v;
    Suuu += u * u * u;
    Suvv += u * v * v;
    Svvv += v * v * v;
    Svuu += v * v * u;
  }

  const det = Suu * Svv - Suv * Suv;
  if (Math.abs(det) < 1e-10) return null; // collinear or degenerate

  const uc = (0.5 * (Suuu + Suvv) * Svv - 0.5 * (Svvv + Svuu) * Suv) / det;
  const vc = (0.5 * (Svvv + Svuu) * Suu - 0.5 * (Suuu + Suvv) * Suv) / det;

  const r = Math.sqrt(uc * uc + vc * vc + (Suu + Svv) / n);
  const cx = uc + mx;
  const cy = vc + my;

  let sumSqErr = 0;
  for (const [x, y] of points) {
    const d = Math.hypot(x - cx, y - cy) - r;
    sumSqErr += d * d;
  }
  const rms = Math.sqrt(sumSqErr / n);

  return { cx, cy, r, rms };
}
