// packages/kernel/src/section/sectionCache.ts
import { Opfs } from '../storage/Opfs';
import type { FaceTagMap } from './cutBySectionPlane';

const LRU_CAP_BYTES = 100 * 1024 * 1024; // 100 MB
const INDEX_PATH = 'cache/section/index.json';

type IndexEntry = { key: string; size: number; lastAccess: number };

export type SectionCacheStore = {
  get(key: string): Promise<{ brep: ArrayBuffer; faceTags: FaceTagMap } | null>;
  put(key: string, brep: ArrayBuffer, faceTags: FaceTagMap): Promise<void>;
  delete(key: string): Promise<void>;
  evict(): Promise<void>;
  clear(): Promise<void>;
};

function brepPath(key: string): string { return `cache/section/${key}.brep`; }
function tagsPath(key: string): string { return `cache/section/${key}.tags.json`; }

function serialiseFaceTagMap(m: FaceTagMap): string {
  return JSON.stringify([...m.entries()]);
}

function deserialiseFaceTagMap(s: string): FaceTagMap {
  const entries = JSON.parse(s) as [string, FaceTagMap extends Map<string, infer V> ? V : never][];
  return new Map(entries);
}

/**
 * Factory that returns a SectionCacheStore backed by the given OPFS root.
 * In production: `makeSectionCache(await navigator.storage.getDirectory())`.
 * In tests: inject an in-memory stub root.
 */
export function makeSectionCache(root: FileSystemDirectoryHandle): SectionCacheStore {
  const opfs = Opfs.forRoot(root);

  async function readIndex(): Promise<IndexEntry[]> {
    try {
      const raw = await opfs.read(INDEX_PATH);
      return JSON.parse(new TextDecoder().decode(raw)) as IndexEntry[];
    } catch {
      return [];
    }
  }

  async function writeIndex(idx: IndexEntry[]): Promise<void> {
    await opfs.write(INDEX_PATH, new TextEncoder().encode(JSON.stringify(idx)));
  }

  return {
    async get(key) {
      const bPath = brepPath(key);
      const tPath = tagsPath(key);
      if (!(await opfs.exists(bPath)) || !(await opfs.exists(tPath))) return null;
      const brepBytes = await opfs.read(bPath);
      const tagsRaw   = await opfs.read(tPath);
      // Update lastAccess in index
      const idx = await readIndex();
      const entry = idx.find(e => e.key === key);
      if (entry) { entry.lastAccess = Date.now(); await writeIndex(idx); }
      const raw = brepBytes.buffer.slice(brepBytes.byteOffset, brepBytes.byteOffset + brepBytes.byteLength);
      return {
        brep: raw instanceof SharedArrayBuffer ? raw.slice(0) as unknown as ArrayBuffer : raw as ArrayBuffer,
        faceTags: deserialiseFaceTagMap(new TextDecoder().decode(tagsRaw)),
      };
    },

    async put(key, brep, faceTags) {
      const brepBytes = new Uint8Array(brep);
      await opfs.write(brepPath(key), brepBytes);
      await opfs.write(tagsPath(key), new TextEncoder().encode(serialiseFaceTagMap(faceTags)));
      const idx = await readIndex();
      const existing = idx.findIndex(e => e.key === key);
      const entry: IndexEntry = { key, size: brepBytes.byteLength, lastAccess: Date.now() };
      if (existing >= 0) idx[existing] = entry; else idx.push(entry);
      await writeIndex(idx);
    },

    async evict() {
      const idx = await readIndex();
      const totalSize = idx.reduce((s, e) => s + e.size, 0);
      if (totalSize <= LRU_CAP_BYTES) return;
      // Sort ascending by lastAccess (oldest first)
      idx.sort((a, b) => a.lastAccess - b.lastAccess);
      let running = totalSize;
      // Walk from oldest; evict until within cap
      let evictUpTo = 0;
      for (let i = 0; i < idx.length; i++) {
        if (running <= LRU_CAP_BYTES) { evictUpTo = i; break; }
        running -= idx[i]!.size;
        evictUpTo = i + 1;
      }
      for (let i = 0; i < evictUpTo; i++) {
        const e = idx[i]!;
        try { await opfs.delete(brepPath(e.key)); } catch { /* already gone */ }
        try { await opfs.delete(tagsPath(e.key)); } catch { /* already gone */ }
      }
      const retained = idx.slice(evictUpTo);
      await writeIndex(retained);
    },

    async delete(key) {
      try { await opfs.delete(brepPath(key)); } catch { /* already gone */ }
      try { await opfs.delete(tagsPath(key)); } catch { /* already gone */ }
      const idx = await readIndex();
      await writeIndex(idx.filter(e => e.key !== key));
    },

    async clear() {
      const idx = await readIndex();
      for (const e of idx) {
        try { await opfs.delete(brepPath(e.key)); } catch { /* ignore */ }
        try { await opfs.delete(tagsPath(e.key)); } catch { /* ignore */ }
      }
      await writeIndex([]);
    },
  };
}

// Singleton for production use — lazy-initialised on first access.
let _store: SectionCacheStore | null = null;

export async function getSectionCache(): Promise<SectionCacheStore> {
  if (!_store) {
    const root = await navigator.storage.getDirectory();
    _store = makeSectionCache(root);
  }
  return _store;
}
