// packages/app/src/drawing/sectionCache.ts
//
// App-level singleton accessor for the section BREP cache.
// The full implementation lives in the kernel package (OPFS-backed, browser-only).
// In tests this module is fully mocked via vi.mock.
// In production the app will wire the real cache via a KernelClient proxy
// in a later phase — for now callers are only exercised through mocks.

import type { FaceTagMap } from '@zilventor/shared/src/drawing/projectSectionView';

export type SectionCacheStore = {
  get(key: string): Promise<{ brep: unknown; faceTags: FaceTagMap } | null>;
  put(key: string, brep: unknown, faceTags: FaceTagMap): Promise<void>;
  delete(key: string): Promise<void>;
};

/**
 * Production singleton — wired to the OPFS-backed kernel cache.
 * Accessing this in a non-browser environment (e.g. unit tests) will throw;
 * tests must mock this module via vi.mock('../../drawing/sectionCache').
 */
export const sectionCache: SectionCacheStore = {
  async get(_key) {
    throw new Error('sectionCache.get: not wired — mock in tests, wire KernelClient in production');
  },
  async put(_key, _brep, _faceTags) {
    throw new Error('sectionCache.put: not wired — mock in tests, wire KernelClient in production');
  },
  async delete(_key) {
    throw new Error('sectionCache.delete: not wired — mock in tests, wire KernelClient in production');
  },
};
