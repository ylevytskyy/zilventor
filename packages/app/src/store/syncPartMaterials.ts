// packages/app/src/store/syncPartMaterials.ts
import { useAppStore } from './useAppStore';

/**
 * Mirror activePart.materials from the Zustand store into the kernel's parts map.
 * No-op when no part is active (assembly / drawing / nothing) — kernel doesn't own
 * assembly materials, so the store is the source of truth for those.
 * No-op when kernel is null (kernel not yet initialized).
 * Call after every store.addMaterial / updateMaterial / removeMaterial in a
 * material-mutating command.
 */
export async function syncPartMaterials(): Promise<void> {
  const { kernel, activePart } = useAppStore.getState();
  if (!kernel || !activePart) return;
  await kernel.setMaterials(activePart.id, activePart.materials);
}
