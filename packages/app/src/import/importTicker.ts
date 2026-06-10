import i18n from '../i18n';

/**
 * Starts a live "Importing STEP…" status ticker.
 *
 * Immediately calls `setStatus` with an initial message, then updates it every
 * second with the elapsed time. Returns a `stop` function that clears the
 * interval — call it in a `finally` block to guarantee no timer leaks.
 *
 * `isCurrent` (default: always true) is polled before every write; when it
 * returns false (e.g. the open was cancelled or superseded) the ticker stops
 * writing and clears itself, so it never overwrites a later status message.
 *
 * Calling `stop()` multiple times is safe (idempotent).
 */
export function startImportTicker(
  setStatus: (msg: string) => void,
  isCurrent: () => boolean = () => true,
): () => void {
  const startMs = Date.now();
  if (isCurrent()) {
    setStatus(i18n.t('status.importingStep'));
  }

  const id = setInterval(() => {
    if (!isCurrent()) {
      clearInterval(id);
      return;
    }
    const elapsed = Math.round((Date.now() - startMs) / 1000);
    const mm = Math.floor(elapsed / 60);
    const ss = String(elapsed % 60).padStart(2, '0');
    const label = mm > 0 ? `${mm}:${ss}` : `${elapsed}s`;
    setStatus(i18n.t('status.importingStepElapsed', { elapsed: label }));
  }, 1000);

  let stopped = false;
  return () => {
    if (!stopped) {
      stopped = true;
      clearInterval(id);
    }
  };
}
