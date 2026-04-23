import { init_planegcs_module, GcsWrapper } from '@salusoft89/planegcs';

export type PlanegcsBundle = {
  GcsWrapper: typeof GcsWrapper;
  createWrapper(): InstanceType<typeof GcsWrapper>;
};

let cached: PlanegcsBundle | null = null;

export async function loadPlanegcs(): Promise<PlanegcsBundle> {
  if (cached) return cached;
  let wasm_url: string | undefined;
  try {
    wasm_url = ((await import('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url')) as { default: string }).default;
    // In Node/Vitest the resolved value is a Vite dev-server URL (/@fs/…) that
    // cannot be opened by the filesystem — skip locateFile and let planegcs
    // resolve the WASM on its own.
    if (typeof wasm_url === 'string' && wasm_url.startsWith('/')) wasm_url = undefined;
  } catch {
    // Node environment without Vite transform — no ?url support.
  }
  const mod = await init_planegcs_module(wasm_url ? { locateFile: () => wasm_url! } : undefined);
  cached = {
    GcsWrapper,
    createWrapper: () => new GcsWrapper(new mod.GcsSystem())
  };
  return cached;
}
