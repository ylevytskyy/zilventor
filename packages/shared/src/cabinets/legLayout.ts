export interface LegLayoutParams {
  width: number;
  depth: number;
  legsPerRow: number;
  sideInset: number;
  frontInset: number;
  backInset: number;
}

export function computeLegPositions(p: LegLayoutParams): Array<{ x: number; y: number }> {
  const { width, depth, legsPerRow: R, sideInset, frontInset, backInset } = p;
  const lo = sideInset;
  const hi = width - sideInset;
  const xs: number[] =
    R <= 1 ? [width / 2] : Array.from({ length: R }, (_, i) => lo + (i * (hi - lo)) / (R - 1));
  const ys = [frontInset, depth - backInset];
  const out: Array<{ x: number; y: number }> = [];
  for (const y of ys) for (const x of xs) out.push({ x, y });
  return out;
}
