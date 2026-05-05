// packages/app/src/drawing/sectionCache.ts
//
// App-level singleton accessor for the section BREP cache.
// The real store is in packages/kernel/src/section/sectionCache.ts (OPFS-backed).
// This module re-exports a lazy singleton for use from app commands.
// In tests it is fully mocked via vi.mock.

import type { FaceTagMap } from '@zilventor/shared/src/drawing/projectSectionView';

export type SectionCacheStore = {
  get(key: string): Promise<{ brep: unknown; faceTags: FaceTagMap } | null>;
  put(key: string, brep: unknown, faceTags: FaceTagMap): Promise<void>;
  delete(key: string): Promise<void>;
};

// Lazy singleton — initialised on first use via navigator.storage.getDirectory().
let _cache: SectionCacheStore | null = null;

async function getCache(): Promise<SectionCacheStore> {
  if (!_cache) {
    // Dynamically import to avoid loading OPFS code in non-browser environments (e.g. tests).
    const { makeSectionCache } = await import(
      /* @vite-ignore */ '../../kernel/src/section/sectionCache'
    );
    const root = await navigator.storage.getDirectory();
    _cache = makeSectionCache(root) as SectionCacheStore;
  }
  return _cache;
}

/**
 * Proxy object that delegates to the lazy singleton.
 * Commands import `sectionCache` and call its methods directly.
 */
export const sectionCache: SectionCacheStore = {
  async get(key) {
    return (await getCache()).get(key);
  },
  async put(key, brep, faceTags) {
    return (await getCache()).put(key, brep as ArrayBuffer, faceTags);
  },
  async delete(key) {
    return (await getCache()).delete(key);
  },
};
