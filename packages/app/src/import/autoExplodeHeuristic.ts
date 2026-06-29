/**
 * Returns true when a STEP import result should be automatically exploded into
 * an assembly: requires more than one solid AND at least two distinct non-null
 * per-solid colors (i.e. the kernel assigned different colors to different
 * bodies, meaning the STEP file carries per-body color metadata).
 *
 * Single-solid, single-color, or no-color imports stay as a normal Part.
 */
export function shouldAutoExplode(
  solidCount: number,
  solidColors: (string | null)[] | undefined,
): boolean {
  if (solidCount <= 1) return false;
  const distinctColors = new Set(
    (solidColors ?? []).filter((c): c is string => c !== null),
  );
  return distinctColors.size >= 2;
}
