// packages/app/src/commands/AddCustomTextureCommand.ts
import type { Command } from './Command';
import type { CustomTextureDef } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { syncPartCustomTextures } from '../store/syncPartCustomTextures';
import type { CustomTextureRegistry } from '../textures/customTextureRegistry';

export interface AddCustomTextureArgs {
  def: CustomTextureDef;
  bytes: Record<string, Uint8Array>;
  registry: CustomTextureRegistry;
}

export class AddCustomTextureCommand implements Command {
  readonly name = 'AddCustomTexture';

  constructor(private args: AddCustomTextureArgs) {}

  async apply(): Promise<void> {
    const { def, bytes, registry } = this.args;

    // Register all present blob ids into the runtime registry (creates blob URLs).
    registry.register([def], bytes);

    // Register EVERY present blob (albedo + normal + roughness) to the kernel
    // so saveToBytes can embed them in the tar archive.
    const { kernel } = useAppStore.getState();
    if (kernel) {
      for (const blobId of [def.albedoBlobId, def.normalBlobId, def.roughnessBlobId].filter(Boolean) as string[]) {
        const blobBytes = bytes[blobId];
        if (blobBytes) {
          await kernel.registerCustomTexture(blobId, blobBytes);
        }
      }
    }

    // Write def into active part / assembly + activeDocument (no divergence).
    useAppStore.getState().addCustomTexture(def);

    // Sync the updated customTextures list into the kernel's parts map.
    await syncPartCustomTextures();
  }

  async revert(): Promise<void> {
    useAppStore.getState().removeCustomTexture(this.args.def.id);
    await syncPartCustomTextures();
    // Object-URL revoke for the removed def is handled at registry teardown
    // (no GC in v1 per spec — bytes stay in the kernel registry harmlessly).
  }
}
