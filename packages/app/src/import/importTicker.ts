/**
 * Starts a live "Importing STEP…" status ticker.
 *
 * Immediately calls `setStatus` with an initial message, then updates it every
 * second with the elapsed time. Returns a `stop` function that clears the
 * interval — call it in a `finally` block to guarantee no timer leaks.
 *
 * Calling `stop()` multiple times is safe (idempotent).
 */
export function startImportTicker(setStatus: (msg: string) => void): () => void {
  const startMs = Date.now();
  setStatus('Importing STEP… (this can take several minutes for large assemblies)');

  const id = setInterval(() => {
    const elapsed = Math.round((Date.now() - startMs) / 1000);
    const mm = Math.floor(elapsed / 60);
    const ss = String(elapsed % 60).padStart(2, '0');
    const label = mm > 0 ? `${mm}:${ss}` : `${elapsed}s`;
    setStatus(`Importing STEP… ${label} elapsed (large assemblies can take several minutes)`);
  }, 1000);

  let stopped = false;
  return () => {
    if (!stopped) {
      stopped = true;
      clearInterval(id);
    }
  };
}
