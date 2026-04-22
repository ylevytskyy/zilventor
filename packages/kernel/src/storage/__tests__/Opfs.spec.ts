import { describe, it, expect } from 'vitest';
import { Opfs } from '../Opfs';

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
      }
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

describe('Opfs (against a FakeRoot)', () => {
  it('writes and reads a blob', async () => {
    const fs = Opfs.forRoot(new FakeRoot() as unknown as FileSystemDirectoryHandle);
    await fs.write('a/b.brep', new Uint8Array([1, 2, 3]));
    expect(await fs.read('a/b.brep')).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('listAll returns nested paths', async () => {
    const fs = Opfs.forRoot(new FakeRoot() as unknown as FileSystemDirectoryHandle);
    await fs.write('x.json', new Uint8Array([1]));
    await fs.write('dir/y.json', new Uint8Array([2]));
    const listed = await fs.listAll();
    expect(listed.sort()).toEqual(['dir/y.json', 'x.json']);
  });

  it('read throws for a non-existent path', async () => {
    const fs = Opfs.forRoot(new FakeRoot() as unknown as FileSystemDirectoryHandle);
    await expect(fs.read('missing.brep')).rejects.toThrow();
  });
});
