import type { AssemblyDocument } from '@zilventor/shared';
import { flattenForSolver, type Pose } from './walkers/flattenForSolver';

/**
 * Compute static inner poses for the leaves of a sub-assembly document, treating
 * the sub-asm as if its top-level constraints had been solved with identity
 * (i.e., each leaf is placed at its declared `position`/`rotation`). This is
 * equivalent to running an identity SolverBridge against `flattenForSolver`'s
 * output, and avoids the heavier path of standing up a long-lived
 * SubAssemblyCache instance just to read inner positions.
 *
 * Limitation: only single-level. Nested sub-assemblies inside this sub-asm are
 * treated opaquely — their leaves aren't reached. The kernel's flexible-sub-asm
 * path remains the way to fully resolve deep hierarchies.
 */
export function computeInnerStaticPoses(doc: AssemblyDocument): Map<string, Pose> {
  const flat = flattenForSolver(doc, { get: () => undefined });
  const out = new Map<string, Pose>();
  for (const [k, idx] of flat.pathToUnknown) {
    out.set(k, flat.unknowns[idx]!);
  }
  return out;
}
