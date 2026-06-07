// packages/app/src/store/syncPartCustomTextures.ts
import { useAppStore } from './useAppStore';

/**
 * Mirror activePart.customTextures from the Zustand store into the kernel's parts map.
 * No-op when no part is active (assembly / drawing / nothing) — kernel doesn't own
 * assembly customTextures, so the store is the source of truth for those.
 * No-op when kernel is null (kernel not yet initialized).
 * Call after every store.addCustomTexture / removeCustomTexture in a
 * custom-texture-mutating command.
 */
export async function syncPartCustomTextures(): Promise<void> {
  const { kernel, activePart } = useAppStore.getState();
  if (!kernel || !activePart) return;
  await kernel.setCustomTextures(activePart.id, activePart.customTextures ?? []);
}
