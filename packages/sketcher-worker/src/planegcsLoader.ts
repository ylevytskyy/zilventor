import { init_planegcs_module, GcsWrapper } from '@salusoft89/planegcs';

export type PlanegcsBundle = {
  GcsWrapper: typeof GcsWrapper;
  createWrapper(): InstanceType<typeof GcsWrapper>;
};

let cached: PlanegcsBundle | null = null;

// Node test env detection. `process.versions.node` is only set in Node (Vitest),
// never in a browser or Web Worker. Using a URL-based heuristic is wrong because
// Vite's production and dev asset URLs both start with '/'.
const isNode =
  typeof process !== 'undefined' &&
  typeof (process as { versions?: { node?: string } }).versions?.node === 'string';

export async function loadPlanegcs(): Promise<PlanegcsBundle> {
  if (cached) return cached;
  let wasm_url: string | undefined;
  if (!isNode) {
    try {
      wasm_url = (
        (await import('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url')) as {
          default: string;
        }
      ).default;
    } catch {
      // Bundler didn't transform the ?url import — planegcs will resolve on its own.
    }
  }
  const mod = await init_planegcs_module(
    wasm_url ? { locateFile: () => wasm_url! } : undefined
  );
  cached = {
    GcsWrapper,
    createWrapper: () => new GcsWrapper(new mod.GcsSystem())
  };
  return cached;
}
