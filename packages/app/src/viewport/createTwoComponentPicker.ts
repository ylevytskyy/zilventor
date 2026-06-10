import { pathKey, type ComponentPath } from '@zilventor/shared';

export interface TwoComponentPicker {
  /** Feed a raycast hit (ComponentPath). Resolves it to a partPath and advances the state machine. */
  pick(path: ComponentPath): void;
  /** The resolved partPath of the first pick, or null if none yet. */
  firstPick(): string | null;
  /** Clear the in-progress first pick. */
  reset(): void;
}

export function createTwoComponentPicker(opts: {
  resolvePartPath: (path: ComponentPath) => string;
  onComplete: (partPathA: string, partPathB: string) => void;
}): TwoComponentPicker {
  let firstPath: ComponentPath | null = null;
  let firstResolved: string | null = null;
  return {
    pick(path) {
      if (firstPath === null) {
        firstPath = path;
        firstResolved = opts.resolvePartPath(path);
        return;
      }
      // Ignore a repeated pick of the SAME component instance.
      if (pathKey(path) === pathKey(firstPath)) return;
      const second = opts.resolvePartPath(path);
      const first = firstResolved!;
      firstPath = null;
      firstResolved = null;
      opts.onComplete(first, second);
    },
    firstPick() { return firstResolved; },
    reset() { firstPath = null; firstResolved = null; },
  };
}
