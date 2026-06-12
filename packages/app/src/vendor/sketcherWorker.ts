import * as Comlink from 'comlink';
import type { SketcherWorkerApi } from '@zilventor/sketcher-worker';
// Vite ?worker import — creates a Worker() factory that spawns from the given module.
import SketcherWorkerCtor from '@zilventor/sketcher-worker/src/worker?worker';

export interface CreateSketcherWorkerApiOpts {
  /**
   * Called when the sketcher worker emits an error event (OOM / fatal crash).
   * The caller is responsible for exiting sketch mode and surfacing a banner.
   */
  onOffline?: () => void;
}

export function createSketcherWorkerApi(opts?: CreateSketcherWorkerApiOpts): SketcherWorkerApi {
  const w = new SketcherWorkerCtor();
  if (opts?.onOffline) {
    w.addEventListener('error', () => { opts.onOffline!(); });
  }
  return Comlink.wrap<SketcherWorkerApi>(w);
}
