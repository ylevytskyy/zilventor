/**
 * Returns true when the browser environment supports all capabilities the app
 * requires: OPFS (Origin Private File System, via navigator.storage.getDirectory),
 * a secure context (HTTPS or localhost), and Web Workers.
 *
 * All three capabilities are required because:
 *   - OPFS: used for persisting assembly/part documents.
 *   - Secure context: OPFS and Service Workers are only available in secure contexts.
 *   - Workers: the geometry kernel runs in a dedicated worker thread.
 *
 * Browser support as of 2026:
 *   - Chrome/Edge 86+: full support.
 *   - Firefox 111+: full support.
 *   - Safari: OPFS in the main thread since Safari 15.2, but OPFS in workers
 *     (required by the kernel) was added only in Safari 16.4. Service-worker
 *     support for OPFS writes remained incomplete as of 17.x — therefore Safari
 *     is unsupported until it fully ships worker OPFS.
 *
 * The `secure` and navigator parameters are injectable for testability.
 */
export function isSupportedEnvironment(
  nav: Navigator = navigator,
  secure: boolean = typeof window === 'undefined' ? true : window.isSecureContext,
): boolean {
  const hasOpfs = typeof nav.storage?.getDirectory === 'function';
  const hasWorkers = typeof Worker !== 'undefined';
  return hasOpfs && secure && hasWorkers;
}
