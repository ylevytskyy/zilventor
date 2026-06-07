import * as THREE from 'three';
import type { TextureDef } from '@zilventor/shared';

export interface CachedTextureSet {
  albedo: THREE.Texture;
  normal?: THREE.Texture;
  roughness?: THREE.Texture;
}

export interface TextureCache {
  loadTextureSet(def: TextureDef): CachedTextureSet;
  disposeTextures(): void;
}

/**
 * Create a texture cache.
 * @param loaderFactory - Optional factory for the THREE.TextureLoader; defaults to
 *   `() => new THREE.TextureLoader()`. Inject a mock in tests.
 *
 * UVs baked in the kernel are in millimeters, so
 *   texture.repeat.set(1 / physicalWidthMm, 1 / physicalHeightMm)
 * maps UV = physicalWidthMm (mm) to exactly one image tile.
 */
export function createTextureCache(loaderFactory?: () => THREE.TextureLoader): TextureCache {
  const cache = new Map<string, CachedTextureSet>();
  const loader = loaderFactory ? loaderFactory() : new THREE.TextureLoader();

  function loadMap(url: string, wMm: number, hMm: number): THREE.Texture {
    const tex = loader.load(url);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1 / wMm, 1 / hMm);
    return tex;
  }

  function loadTextureSet(def: TextureDef): CachedTextureSet {
    const hit = cache.get(def.id);
    if (hit) return hit;
    const { physicalWidthMm, physicalHeightMm } = def;
    const set: CachedTextureSet = {
      albedo: loadMap(def.albedoUrl, physicalWidthMm, physicalHeightMm),
      ...(def.normalUrl ? { normal: loadMap(def.normalUrl, physicalWidthMm, physicalHeightMm) } : {}),
      ...(def.roughnessUrl ? { roughness: loadMap(def.roughnessUrl, physicalWidthMm, physicalHeightMm) } : {}),
    };
    cache.set(def.id, set);
    return set;
  }

  function disposeTextures(): void {
    for (const set of cache.values()) {
      set.albedo.dispose();
      set.normal?.dispose();
      set.roughness?.dispose();
    }
    cache.clear();
  }

  return { loadTextureSet, disposeTextures };
}

/** Module-level singleton used by SceneManager. */
export const globalTextureCache: TextureCache = createTextureCache();
