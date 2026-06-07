import type { CustomTextureDef, TextureDef } from '@zilventor/shared';

export interface CustomTextureRegistry {
  register(defs: CustomTextureDef[], bytesById: Record<string, Uint8Array>): void;
  get(id: string): TextureDef | undefined;
  getBytes(blobId: string): Uint8Array | undefined;
  revokeAll(): void;
}

export function createCustomTextureRegistry(): CustomTextureRegistry {
  const defs = new Map<string, TextureDef>();
  const bytes = new Map<string, Uint8Array>();
  const urls: string[] = [];

  function urlFor(blobId: string): string {
    const b = bytes.get(blobId);
    if (!b) throw new Error(`customTextureRegistry: missing bytes for ${blobId}`);
    // Copy into a standalone ArrayBuffer so Blob ownership is independent of the map entry.
    const u = URL.createObjectURL(new Blob([b.slice()], { type: 'image/jpeg' }));
    urls.push(u);
    return u;
  }

  return {
    register(newDefs, bytesById) {
      for (const [k, v] of Object.entries(bytesById)) bytes.set(k, v);
      for (const d of newDefs) {
        defs.set(d.id, {
          id: d.id,
          name: d.name,
          physicalWidthMm: d.physicalWidthMm,
          physicalHeightMm: d.physicalHeightMm,
          albedoUrl: urlFor(d.albedoBlobId),
          ...(d.normalBlobId ? { normalUrl: urlFor(d.normalBlobId) } : {}),
          ...(d.roughnessBlobId ? { roughnessUrl: urlFor(d.roughnessBlobId) } : {}),
        });
      }
    },
    get: (id) => defs.get(id),
    getBytes: (blobId) => bytes.get(blobId),
    revokeAll() {
      for (const u of urls) URL.revokeObjectURL(u);
      urls.length = 0;
      defs.clear();
      bytes.clear();
    },
  };
}

/** Module-level singleton — matches Phase 1's globalTextureCache pattern.
 *  App.tsx populates this with register() on document activate;
 *  SceneManager receives it via setCustomTextureRegistry(). */
export const globalCustomTextureRegistry = createCustomTextureRegistry();

export function collectCustomTextureBytes(
  defs: CustomTextureDef[] | undefined,
  reg: CustomTextureRegistry,
): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const d of defs ?? []) {
    for (const ref of [d.albedoBlobId, d.normalBlobId, d.roughnessBlobId]) {
      if (!ref) continue;
      const b = reg.getBytes(ref);
      if (b) out[ref] = b;
    }
  }
  return out;
}
