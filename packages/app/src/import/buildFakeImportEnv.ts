/**
 * In-memory `FileSystemDirectoryHandle`-shaped factories used by:
 *   - the Inventor importer unit tests (`InventorImporter.spec.ts`)
 *   - the dev-only `__zilventorImportFromFiles` window hook (E2E tests)
 *
 * Implements the subset of the Web FS API that `runInventorImport` actually calls:
 *   - input dir: async `entries()` iterator + `getDirectoryHandle()`
 *   - target dir: `getFileHandle({ create })` + `getDirectoryHandle({ create })` + `createWritable()`
 */

export type FakeFiles = Record<string, string | Uint8Array>;

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function normalizeEntries(files: FakeFiles): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) {
    out[k] = typeof v === 'string' ? utf8(v) : v;
  }
  return out;
}

/** Build a read-only input dir handle from `{ filename → bytes/utf8 }`. */
export function makeFakeInputDir(files: FakeFiles): FileSystemDirectoryHandle {
  const entries = normalizeEntries(files);
  return makeInputDirNode(entries) as unknown as FileSystemDirectoryHandle;
}

function makeInputDirNode(entries: Record<string, Uint8Array | Record<string, unknown>>): unknown {
  return {
    kind: 'directory',
    async *entries() {
      for (const [name, val] of Object.entries(entries)) {
        if (val instanceof Uint8Array) {
          yield [name, {
            kind: 'file', name,
            getFile: async () => ({
              arrayBuffer: async () => val.buffer.slice(val.byteOffset, val.byteOffset + val.byteLength),
            }),
          }];
        } else {
          yield [name, makeInputDirNode(val as Record<string, Uint8Array | Record<string, unknown>>)];
        }
      }
    },
    async getDirectoryHandle(name: string) {
      const child = entries[name];
      if (child instanceof Uint8Array || child === undefined) throw new Error(`not a dir: ${name}`);
      return makeInputDirNode(child as Record<string, Uint8Array | Record<string, unknown>>);
    },
  };
}

/** Build a writable target dir handle plus a `Map<path, bytes>` capturing every successful write. */
export function makeFakeWritableTarget(): {
  dir: FileSystemDirectoryHandle;
  writes: Map<string, Uint8Array>;
} {
  const writes = new Map<string, Uint8Array>();
  function makeDirNode(prefix: string): unknown {
    const fileNames = new Set<string>();
    return {
      kind: 'directory' as const,
      async getFileHandle(name: string, _opts: { create?: boolean }) {
        if (!fileNames.has(name) && !writes.has(prefix + name) && !_opts?.create) {
          throw new DOMException('not found', 'NotFoundError');
        }
        fileNames.add(name);
        return {
          kind: 'file' as const, name,
          async createWritable() {
            const chunks: Uint8Array[] = [];
            return {
              async write(data: Uint8Array | { type: string; data?: Uint8Array }) {
                if (data instanceof Uint8Array) chunks.push(data);
                else if ((data as { data?: Uint8Array }).data) chunks.push((data as { data: Uint8Array }).data);
              },
              async close() {
                const total = chunks.reduce((a, c) => a + c.byteLength, 0);
                const merged = new Uint8Array(total);
                let off = 0; for (const c of chunks) { merged.set(c, off); off += c.byteLength; }
                writes.set(prefix + name, merged);
              },
            };
          },
        };
      },
      async getDirectoryHandle(name: string, _opts: { create?: boolean }) {
        return makeDirNode(`${prefix}${name}/`);
      },
    };
  }
  return { dir: makeDirNode('') as unknown as FileSystemDirectoryHandle, writes };
}
