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

/**
 * Spawn the kernel Web Worker, wrap it via Comlink, and call init().
 *
 * NOTE FOR PRODUCTION: this uses `new Worker(new URL(...), { type: 'module' })`
 * which Vite will transform at build time. The path must resolve to the
 * kernel's worker.ts. We also reserve a `terminate` fn to kill the worker
 * cleanly on unmount.
 */
export async function spawnKernel(): Promise<{ client: KernelClient; terminate(): void }> {
  // Vite resolves the URL to the built worker chunk at build time.
  const workerUrl = new URL('../../../kernel/src/worker.ts', import.meta.url);
  const worker = new Worker(workerUrl, { type: 'module' });
  const proxy = Comlink.wrap<KernelApi>(worker);
  await proxy.init();
  return {
    client: createKernelClient(proxy),
    terminate: () => worker.terminate()
  };
}
