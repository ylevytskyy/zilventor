// packages/kernel/src/section/sectionCache.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { makeSectionCache, type SectionCacheStore } from './sectionCache';
import type { FaceTagMap } from './cutBySectionPlane';

// Minimal in-memory OPFS stub using a nested Map tree.
function makeMemoryOpfsRoot(): FileSystemDirectoryHandle {
  const files = new Map<string, Uint8Array>();

  function makeDir(prefix: string): FileSystemDirectoryHandle {
    return {
      kind: 'directory',
      name: prefix,
      async getDirectoryHandle(name: string, _opts?: { create?: boolean }) {
        return makeDir(prefix ? `${prefix}/${name}` : name);
      },
      async getFileHandle(name: string, opts?: { create?: boolean }) {
        const fullPath = prefix ? `${prefix}/${name}` : name;
        if (!opts?.create && !files.has(fullPath)) throw new Error(`no file: ${fullPath}`);
        return {
          kind: 'file',
          name,
          async getFile() {
            const data = files.get(fullPath) ?? new Uint8Array(0);
            return { arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) } as unknown as File;
          },
          async createWritable() {
            const chunks: Uint8Array[] = [];
            return {
              async write(data: Uint8Array | string | BufferSource) {
                chunks.push(data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer));
              },
              async close() {
                const total = chunks.reduce((a, b) => a + b.length, 0);
                const buf = new Uint8Array(total);
                let off = 0;
                for (const c of chunks) { buf.set(c, off); off += c.length; }
                files.set(fullPath, buf);
              },
            } as unknown as FileSystemWritableFileStream;
          },
        } as unknown as FileSystemFileHandle;
      },
      async removeEntry(name: string) {
        const fullPath = prefix ? `${prefix}/${name}` : name;
        files.delete(fullPath);
      },
      [Symbol.asyncIterator](): AsyncIterator<[string, FileSystemHandle]> {
        // Return entries that start with this prefix
        const relevant = [...files.entries()].filter(([k]) => {
          return prefix ? k.startsWith(prefix + '/') : true;
        });
        let i = 0;
        return {
          async next() {
            if (i >= relevant.length) return { done: true, value: undefined as never };
            const [fullPath] = relevant[i++]!;
            const stripped = prefix ? fullPath.slice(prefix.length + 1) : fullPath;
            const name = stripped.split('/')[0]!;
            return { done: false, value: [name, { kind: 'file', name }] as [string, FileSystemHandle] };
          },
        };
      },
    } as unknown as FileSystemDirectoryHandle;
  }

  return makeDir('');
}

let cache: SectionCacheStore;
beforeEach(() => {
  const root = makeMemoryOpfsRoot();
  cache = makeSectionCache(root);
});

describe('sectionCache.get / put round-trip', () => {
  it('put then get returns identical bytes and faceTags', async () => {
    const brep = new Uint8Array([0x42, 0x52, 0x45, 0x50]).buffer; // "BREP"
    const tags: FaceTagMap = new Map([
      ['k1', { tag: 'cut-face', partId: 'p1', materialId: 'm1' }],
    ]);
    await cache.put('key-abc', brep, tags);
    const got = await cache.get('key-abc');
    expect(got).not.toBeNull();
    const bytes = new Uint8Array(got!.brep);
    expect(bytes).toEqual(new Uint8Array([0x42, 0x52, 0x45, 0x50]));
    expect(got!.faceTags.get('k1')?.tag).toBe('cut-face');
  });

  it('get on missing key returns null', async () => {
    const result = await cache.get('nonexistent');
    expect(result).toBeNull();
  });
});

describe('sectionCache.evict', () => {
  it('evicts LRU entries when total size exceeds cap', async () => {
    // Put two 60 MB entries to exceed 100 MB cap.
    const brep60mb = new ArrayBuffer(60 * 1024 * 1024);
    await cache.put('key-old', brep60mb, new Map());
    await cache.put('key-new', brep60mb, new Map());
    await cache.evict();
    // oldest should be evicted, newest retained
    expect(await cache.get('key-old')).toBeNull();
    expect(await cache.get('key-new')).not.toBeNull();
  });

  it('does not evict when total size is within cap', async () => {
    const small = new ArrayBuffer(1024);
    await cache.put('k1', small, new Map());
    await cache.put('k2', small, new Map());
    await cache.evict();
    expect(await cache.get('k1')).not.toBeNull();
    expect(await cache.get('k2')).not.toBeNull();
  });
});

describe('sectionCache.delete', () => {
  it('put → delete → get returns null', async () => {
    await cache.put('key-del', new ArrayBuffer(4), new Map());
    await cache.delete('key-del');
    expect(await cache.get('key-del')).toBeNull();
  });

  it('delete on missing key is a no-op (no throw)', async () => {
    await expect(cache.delete('nonexistent-key')).resolves.toBeUndefined();
  });
});

describe('sectionCache.clear', () => {
  it('removes all entries', async () => {
    await cache.put('k1', new ArrayBuffer(4), new Map());
    await cache.put('k2', new ArrayBuffer(4), new Map());
    await cache.clear();
    expect(await cache.get('k1')).toBeNull();
    expect(await cache.get('k2')).toBeNull();
  });
});
