import * as Comlink from 'comlink';
import type { SketcherWorkerApi } from '@zilventor/sketcher-worker';
// Vite ?worker import — creates a Worker() factory that spawns from the given module.
import SketcherWorkerCtor from '@zilventor/sketcher-worker/src/worker?worker';

export function createSketcherWorkerApi(): SketcherWorkerApi {
  const w = new SketcherWorkerCtor();
  return Comlink.wrap<SketcherWorkerApi>(w);
}
