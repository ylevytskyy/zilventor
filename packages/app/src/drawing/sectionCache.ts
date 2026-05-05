// packages/app/src/drawing/sectionCache.ts
//
// Session-level in-memory cache for section cut results (ProjectorInput +
// FaceTagMap). Keyed by plane fingerprint; evicted when the user closes the tab.
//
// The kernel-side OPFS cache stores raw BREP bytes for in-worker reuse.
// The app side stores the already-tessellated ProjectorInput so that
// AddSectionViewCommand can skip re-cutting on redo without a round-trip.
//
// In tests this module is fully mocked via vi.mock.

import type { FaceTagMap } from '@zilventor/shared/src/drawing/projectSectionView';

export type SectionCacheStore = {
  get(key: string): Promise<{ brep: unknown; faceTags: FaceTagMap } | null>;
  put(key: string, brep: unknown, faceTags: FaceTagMap): Promise<void>;
  delete(key: string): Promise<void>;
};

const _store = new Map<string, { brep: unknown; faceTags: FaceTagMap }>();

export const sectionCache: SectionCacheStore = {
  async get(key) {
    return _store.get(key) ?? null;
  },
  async put(key, brep, faceTags) {
    _store.set(key, { brep, faceTags });
  },
  async delete(key) {
    _store.delete(key);
  },
};
