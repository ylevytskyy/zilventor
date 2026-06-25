import type { ComponentPath } from '@zilventor/shared';

export interface OneComponentPicker {
  /** Feed a raycast hit (ComponentPath). Resolves it to a partPath and fires onPick. */
  pick(path: ComponentPath): void;
  /** No-op state reset (one-shot picker holds no in-progress state); present for parity with TwoComponentPicker. */
  reset(): void;
}

/**
 * Creates a single-component picker.
 *
 * Takes TWO positional args (mirroring createTwoComponentPicker(resolvePartPath, onComplete)):
 * - resolvePartPath: maps a ComponentPath raycast hit to the part's OPFS path
 * - onPick: called synchronously with the resolved partPath and raw ComponentPath
 *
 * Returns { pick(path), reset() }. Each .pick() call fires onPick immediately
 * (one-shot: no waiting-for-second-pick state machine). Viewport.beginOneComponentPick
 * wraps this and exposes { pick(clientX, clientY), reset() } to App.tsx.
 *
 * App.tsx is responsible for feeding .pick(clientX, clientY) on canvas pointer events —
 * this picker does NOT auto-subscribe to DOM events.
 */
export function createOneComponentPicker(
  resolvePartPath: (path: ComponentPath) => string,
  onPick: (partPath: string, path: ComponentPath) => void | Promise<void>,
): OneComponentPicker {
  return {
    pick(path) {
      void onPick(resolvePartPath(path), path);
    },
    reset() { /* one-shot: nothing to clear */ },
  };
}
