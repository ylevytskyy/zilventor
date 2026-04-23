import * as Comlink from 'comlink';
import type { KernelApi } from '@zilventor/kernel/src/api';

export type KernelClient = KernelApi;

/**
 * Wrap an already-resolved Comlink proxy. This is the unit-testable entry point
 * — in production, use `spawnKernel()` which handles Worker creation.
 */
export function createKernelClient(proxy: KernelApi): KernelClient {
  return proxy;
}

export type SpawnKernelOptions = {
  /**
   * Fired if two consecutive heartbeat pings fail (each with a 2s timeout).
   * When this fires the heartbeat is stopped — the caller is expected to
   * tear down and respawn the worker.
   */
  onOffline?: () => void;
};

/**
 * Spawn the kernel Web Worker, wrap it via Comlink, and call init().
 *
 * NOTE FOR PRODUCTION: this uses `new Worker(new URL(...), { type: 'module' })`
 * which Vite will transform at build time. The path must resolve to the
 * kernel's worker.ts. We also reserve a `terminate` fn to kill the worker
 * cleanly on unmount.
 */
export async function spawnKernel(
  opts?: SpawnKernelOptions
): Promise<{ client: KernelClient; terminate(): void }> {
  // Vite resolves the URL to the built worker chunk at build time.
  const workerUrl = new URL('../../../kernel/src/worker.ts', import.meta.url);
  const worker = new Worker(workerUrl, { type: 'module' });
  const proxy = Comlink.wrap<KernelApi>(worker);
  // Expose Comlink on `window` so E2E tests can wrap test-injected handles
  // (FakeFileSystemFileHandle) with `Comlink.proxy()` — plain class
  // instances don't survive postMessage's structured-clone.
  (globalThis as unknown as { __comlink?: typeof Comlink }).__comlink = Comlink;
  await proxy.init();

  // Heartbeat: every 3s ping; after 2 consecutive failures (2s timeout each),
  // fire onOffline. Best-effort — we don't need airtight coverage here, just
  // a signal the worker is stuck or dead.
  let interval: ReturnType<typeof setInterval> | null = null;
  if (opts?.onOffline) {
    const onOffline = opts.onOffline;
    let failures = 0;
    interval = setInterval(async () => {
      try {
        await Promise.race([
          proxy.ping('heartbeat'),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('heartbeat timeout')), 2000)
          )
        ]);
        failures = 0;
      } catch {
        failures += 1;
        if (failures >= 2) {
          if (interval) clearInterval(interval);
          interval = null;
          onOffline();
        }
      }
    }, 3000);
  }

  return {
    client: createKernelClient(proxy),
    terminate: () => {
      if (interval) clearInterval(interval);
      interval = null;
      worker.terminate();
    }
  };
}
