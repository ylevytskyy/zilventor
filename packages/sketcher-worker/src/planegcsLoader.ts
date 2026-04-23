import { init_planegcs_module, GcsWrapper } from '@salusoft89/planegcs';

export type PlanegcsBundle = {
  GcsWrapper: typeof GcsWrapper;
  createWrapper(): InstanceType<typeof GcsWrapper>;
};

let cached: PlanegcsBundle | null = null;

export async function loadPlanegcs(): Promise<PlanegcsBundle> {
  if (cached) return cached;
  const mod = await init_planegcs_module();
  cached = {
    GcsWrapper,
    createWrapper: () => new GcsWrapper(new mod.GcsSystem())
  };
  return cached;
}
