import * as Comlink from 'comlink';
import type { KernelApi } from '@zilventor/kernel/src/api';
// Vite ?worker import — Vite bundles the kernel worker as a separate chunk and
// emits the OCCT glue + WASM alongside it. Mirrors the sketcher-worker pattern
// in packages/app/src/vendor/sketcherWorker.ts. The raw `new Worker(new URL(…))`
// form inlines the TypeScript as a data: URL in production builds (unusable).
import KernelWorkerCtor from '@zilventor/kernel/src/worker?worker';

export type KernelClient = KernelApi;

/**
 * Wrap an already-resolved Comlink proxy. This is the unit-testable entry point
 * — in production, use `spawnKernel()` which handles Worker creation.
 */
export function createKernelClient(proxy: KernelApi): KernelClient {
  return proxy;
}

// ---------------------------------------------------------------------------
// createPendingTracker
// ---------------------------------------------------------------------------

export interface PendingTracker {
  /** Number of in-flight async calls on the wrapped proxy. */
  readonly pending: number;
  /**
   * Returns a Proxy around `obj` whose function-valued props are intercepted:
   * each call increments `pending`, and the returned promise decrements it
   * (via `.finally`) on both resolve and reject.
   * Non-function props are passed through unchanged.
   * IMPORTANT: Comlink callable-proxy props report typeof 'function' — call
   * as `orig(...args)` not `orig.apply(...)` to stay compatible.
   */
  wrap<T extends object>(obj: T): T;
}

export function createPendingTracker(): PendingTracker {
  let n = 0;
  return {
    get pending() { return n; },
    wrap<T extends object>(obj: T): T {
      return new Proxy(obj, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (typeof value !== 'function') return value;
          // Capture original; call as plain function (Comlink proxies work this way)
          const orig = value as (...args: unknown[]) => unknown;
          return (...args: unknown[]) => {
            n++;
            return Promise.resolve(orig(...args)).finally(() => { n--; });
          };
        }
      });
    }
  };
}

// ---------------------------------------------------------------------------
// startHeartbeat
// ---------------------------------------------------------------------------

export interface HeartbeatOptions {
  /** Async function that pings the worker (uses the RAW proxy, not wrapped). */
  ping: () => Promise<unknown>;
  /** Returns true when a kernel call is currently in flight. */
  isBusy: () => boolean;
  /** Called when maxFailures consecutive idle-ping timeouts have occurred. */
  onOffline: () => void;
  /** Interval between heartbeat ticks in ms (default 3000). */
  intervalMs?: number;
  /** Per-ping timeout in ms (default 2000). */
  timeoutMs?: number;
  /** Consecutive failures needed to trigger onOffline (default 2). */
  maxFailures?: number;
}

/**
 * Starts a heartbeat that monitors whether the kernel worker is alive.
 * While any kernel call is pending (`isBusy()` returns true) the ping is
 * skipped and the failure counter is reset — an in-flight Comlink call IS
 * proof of life on a single-threaded worker.
 * Returns a `stop()` function that clears the interval.
 */
export function startHeartbeat({
  ping,
  isBusy,
  onOffline,
  intervalMs = 3000,
  timeoutMs = 2000,
  maxFailures = 2
}: HeartbeatOptions): () => void {
  let failures = 0;
  let interval: ReturnType<typeof setInterval> | null = setInterval(async () => {
    // Skip ping while a kernel call is in flight — that's proof of life.
    if (isBusy()) {
      failures = 0;
      return;
    }
    try {
      await Promise.race([
        ping(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('heartbeat timeout')), timeoutMs)
        )
      ]);
      failures = 0;
    } catch {
      failures += 1;
      if (failures >= maxFailures) {
        if (interval) clearInterval(interval);
        interval = null;
        onOffline();
      }
    }
  }, intervalMs);

  return () => {
    if (interval) clearInterval(interval);
    interval = null;
  };
}

// ---------------------------------------------------------------------------
// SpawnKernelOptions / spawnKernel
// ---------------------------------------------------------------------------

export type SpawnKernelOptions = {
  /**
   * Fired if two consecutive heartbeat pings fail (each with a 2s timeout),
   * OR if the worker emits an error event during a long operation.
   * When this fires the heartbeat is stopped — the caller is expected to
   * tear down and respawn the worker.
   */
  onOffline?: () => void;
};

/**
 * Spawn the kernel Web Worker, wrap it via Comlink, and call init().
 *
 * NOTE FOR PRODUCTION: the worker is spawned via a Vite `?worker` import
 * (`import KernelWorkerCtor from '@zilventor/kernel/src/worker?worker'`).
 * Vite bundles the worker as a real, separate ES-module chunk and emits all
 * its transitive dependencies (OCCT glue + .wasm references).  The old
 * `new Worker(new URL('../../../kernel/src/worker.ts'))` form was inlined as a
 * `data:video/mp2t` URL in production builds, causing a SyntaxError at
 * runtime — the `?worker` import eliminates that class of bug.
 */
export async function spawnKernel(
  opts?: SpawnKernelOptions
): Promise<{ client: KernelClient; terminate(): void }> {
  // KernelWorkerCtor is a Vite ?worker factory — Vite bundles the worker as a
  // separate ES-module chunk and emits all its dependencies (OCCT glue + .wasm).
  const worker = new KernelWorkerCtor();
  const proxy = Comlink.wrap<KernelApi>(worker);
  // Expose Comlink on `window` so E2E tests can wrap test-injected handles
  // (FakeFileSystemFileHandle) with `Comlink.proxy()` — plain class
  // instances don't survive postMessage's structured-clone.
  (globalThis as unknown as { __comlink?: typeof Comlink }).__comlink = Comlink;
  await proxy.init();

  const tracker = createPendingTracker();

  let stopHeartbeat: (() => void) | null = null;
  if (opts?.onOffline) {
    const onOffline = opts.onOffline;

    // Wire worker hard-crash → onOffline (catches crashes during long ops
    // when the idle-ping gate means heartbeat can't detect them).
    worker.addEventListener('error', () => { onOffline(); });

    // Heartbeat uses the RAW proxy for ping (not counted as pending).
    stopHeartbeat = startHeartbeat({
      ping: () => proxy.ping('heartbeat'),
      isBusy: () => tracker.pending > 0,
      onOffline
    });
  }

  return {
    client: createKernelClient(tracker.wrap(proxy)),
    terminate: () => {
      if (stopHeartbeat) stopHeartbeat();
      stopHeartbeat = null;
      worker.terminate();
    }
  };
}
