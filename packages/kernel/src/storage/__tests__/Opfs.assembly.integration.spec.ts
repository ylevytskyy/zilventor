import { describe, it, expect } from 'vitest';
import { Opfs } from '../Opfs';
import { packAssembly, unpackAssembly } from '../AssemblyPacker';
import { packProject } from '../ProjectPacker';
import type { AssemblyDocument } from '@zilventor/shared';

// ---------------------------------------------------------------------------
// Minimal in-memory OPFS stub — mirrors the pattern in Opfs.spec.ts
// ---------------------------------------------------------------------------

class FakeFile {
  constructor(public data: Uint8Array = new Uint8Array()) {}
  readonly kind = 'file' as const;
  async getFile() {
    const d = this.data;
    return { arrayBuffer: async () => d.slice().buffer };
  }
  async createWritable() {
    const chunks: Uint8Array[] = [];
    return {
      write: async (c: Uint8Array) => { chunks.push(c); },
      close: async () => {
        const total = chunks.reduce((n, c) => n + c.byteLength, 0);
        const flat = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { flat.set(c, off); off += c.byteLength; }
        this.data = flat;
      },
    };
  }
}

class FakeRoot {
  readonly kind = 'directory' as const;
  readonly entries = new Map<string, FakeFile | FakeRoot>();

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FakeRoot> {
    let entry = this.entries.get(name);
    if (!entry) {
      if (!opts?.create) throw new Error(`no dir ${name}`);
      entry = new FakeRoot();
      this.entries.set(name, entry);
    }
    if (entry.kind !== 'directory') throw new Error(`${name} is a file`);
    return entry;
  }

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<FakeFile> {
    let entry = this.entries.get(name);
    if (!entry) {
      if (!opts?.create) throw new Error(`no file ${name}`);
      entry = new FakeFile();
      this.entries.set(name, entry);
    }
    if (entry.kind !== 'file') throw new Error(`${name} is a directory`);
    return entry;
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<readonly [string, FakeFile | FakeRoot]> {
    for (const [name, h] of this.entries) yield [name, h] as const;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const THUMB = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function makeOpfs(): Opfs {
  return Opfs.forRoot(new FakeRoot() as unknown as FileSystemDirectoryHandle);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Opfs — assembly integration', () => {
  it('saves and loads a .ziasm file (round-trip)', async () => {
    const opfs = makeOpfs();

    const doc: AssemblyDocument = {
      id: 'A1',
      name: 'cabinet',
      units: 'mm',
      parameters: {},
      components: [],
      constraints: [],
      groundedComponentIds: [],
      colors: {},
      bomItemNumbers: {},
    };

    const bytes = await packAssembly(doc, THUMB);
    await opfs.write('test.ziasm', bytes);

    const loaded = await opfs.read('test.ziasm');
    const out = await unpackAssembly(loaded);

    expect(out).toEqual(doc);
  });

  it('an assembly with partPath references a co-resident part on OPFS', async () => {
    const opfs = makeOpfs();

    // Save a minimal part archive at a nested path
    const partBytes = await packProject({
      manifest: { formatVersion: 7, kind: 'part', document: { id: 'P1', name: 'leg' } },
      blobs: {},
      thumbnail: THUMB,
    });
    await opfs.write('parts/leg.zipt', partBytes);

    // Save an assembly that references that part
    const asmDoc: AssemblyDocument = {
      id: 'A1',
      name: 'cabinet',
      units: 'mm',
      parameters: {},
      components: [
        {
          id: 'C1',
          partPath: 'parts/leg.zipt',
          position: { x: 0, y: 0, z: 0 },
          rotation: { rx: 0, ry: 0, rz: 0 },
          visible: true,
        },
      ],
      constraints: [],
      groundedComponentIds: [],
      colors: {},
      bomItemNumbers: {},
    };
    const asmBytes = await packAssembly(asmDoc, THUMB);
    await opfs.write('cabinet.ziasm', asmBytes);

    // Round-trip the assembly
    const asmOut = await unpackAssembly(await opfs.read('cabinet.ziasm'));
    expect(asmOut.components[0]!.partPath).toBe('parts/leg.zipt');

    // Verify the part is independently resolvable at its path
    const partLoaded = await opfs.read('parts/leg.zipt');
    expect(partLoaded.length).toBeGreaterThan(0);

    // Both files should appear in a listing
    const listing = await opfs.listAll();
    expect(listing.sort()).toEqual(['cabinet.ziasm', 'parts/leg.zipt']);
  });

  it('read rejects on a non-existent path', async () => {
    const opfs = makeOpfs();
    await expect(opfs.read('nonexistent.ziasm')).rejects.toThrow();
  });
});
