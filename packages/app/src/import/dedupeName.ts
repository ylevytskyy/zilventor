/**
 * Returns `base` if it is not in `existingNames`, otherwise appends
 * the lowest free suffix: `base (2)`, `base (3)`, …
 *
 * @param base          Desired name (e.g. `'hinge-blum-110'`).
 * @param existingNames All names already in use (e.g. from OPFS listing).
 */
export function dedupeName(base: string, existingNames: string[]): string {
  const taken = new Set(existingNames);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}
