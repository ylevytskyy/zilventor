/**
 * Pure decisions extracted from invalidatePartPaths / the param→re-execute path so the
 * reflow-trigger logic (the milestone's headline feature) is unit-testable in isolation.
 */

/** True when invalidating part caches should mark the assembly solver dirty (reflow). */
export function shouldReflowAfterInvalidate(
  activeDocument: { kind: string } | null | undefined,
): boolean {
  return activeDocument?.kind === 'assembly';
}

/**
 * Invert assemblyPartIdCacheRef (partPath → kernelId) to recover the OPFS partPath for a
 * kernel part UUID. Returns undefined when the id was never loaded as an assembly component.
 */
export function partPathForKernelId(
  entries: Iterable<readonly [string, string]>,
  kernelId: string,
): string | undefined {
  for (const [partPath, id] of entries) {
    if (id === kernelId) return partPath;
  }
  return undefined;
}
