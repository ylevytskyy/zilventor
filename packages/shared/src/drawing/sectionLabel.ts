// packages/shared/src/drawing/sectionLabel.ts

/** Letters excluded per ANSI Y14.3 — avoid confusion with digits 1 and 0. */
const SKIP = new Set(['I', 'O']);

/** Ordered valid single-character label tokens (A-Z minus I, O). */
const CHARS: string[] = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  .split('')
  .filter((c) => !SKIP.has(c));

/**
 * Generate the sequence of valid labels in order:
 * A, B, ..., Z (minus I, O), then AA, AB, ..., AZ, BA, ...
 *
 * Each call to the returned iterator yields the next label string.
 */
function* labelSequence(): Generator<string> {
  // Single-character labels
  for (const c of CHARS) {
    yield c;
  }
  // Two-character labels (both characters from CHARS)
  for (const prefix of CHARS) {
    for (const suffix of CHARS) {
      yield prefix + suffix;
    }
  }
  // Three-character labels (rarely needed but defined for completeness)
  for (const a of CHARS) {
    for (const b of CHARS) {
      for (const c of CHARS) {
        yield a + b + c;
      }
    }
  }
}

/**
 * Return the lowest label not in `existingLabels`.
 * Skips I and O per ANSI Y14.3. Fills gaps.
 * `existingLabels` must include labels from BOTH SectionView and DetailView
 * arrays on the same sheet so the two view types share one callout pool.
 */
export function allocateCalloutLabel(existingLabels: string[]): string {
  const used = new Set(existingLabels);
  const maxLen = existingLabels.reduce((m, l) => Math.max(m, l.length), 0);
  for (const label of labelSequence()) {
    if (label.length < maxLen) continue;
    if (!used.has(label)) return label;
  }
  // Unreachable in any practical drawing
  throw new Error('allocateCalloutLabel: label space exhausted');
}
