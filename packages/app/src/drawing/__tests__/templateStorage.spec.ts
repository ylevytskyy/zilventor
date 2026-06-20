import { describe, it, expect } from 'vitest';
import { Opfs } from '@zilventor/kernel/src/storage/Opfs';
import { exportDrawingTemplate } from '@zilventor/shared';
import type { DrawingSheet } from '@zilventor/shared';
import { saveTemplate, listTemplates, loadTemplate, templatePath } from '../templateStorage';

// Minimal in-memory OPFS root (mirrors packages/kernel Opfs.spec FakeRoot).
class FakeFile {
  constructor(public data: Uint8Array = new Uint8Array()) {}
  readonly kind = 'file' as const;
  async getFile() { const d = this.data; return { arrayBuffer: async () => d.slice().buffer }; }
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
    let e = this.entries.get(name);
    if (!e) { if (!opts?.create) throw new Error(`no dir ${name}`); e = new FakeRoot(); this.entries.set(name, e); }
    if (e.kind !== 'directory') throw new Error(`${name} is a file`);
    return e;
  }
  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<FakeFile> {
    let e = this.entries.get(name);
    if (!e) { if (!opts?.create) throw new Error(`no file ${name}`); e = new FakeFile(); this.entries.set(name, e); }
    if (e.kind !== 'file') throw new Error(`${name} is a directory`);
    return e;
  }
  async *[Symbol.asyncIterator]() { for (const [n, h] of this.entries) yield [n, h] as const; }
}

function fakeOpfs(): Opfs {
  return Opfs.forRoot(new FakeRoot() as unknown as FileSystemDirectoryHandle);
}

function makeSheet(name: string): DrawingSheet {
  return {
    id: 's1', name, size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
    views: [], dimensions: [], annotations: [],
    titleBlock: { drawnBy: 'YL', revision: 'A' }, dimensionGroups: [],
  };
}

describe('templateStorage (slice 4)', () => {
  it('templatePath slugifies under templates/', () => {
    expect(templatePath('Shop A3')).toBe('templates/shop-a3.zitpl');
  });

  it('save → list → load round-trips a template', async () => {
    const opfs = fakeOpfs();
    const t = exportDrawingTemplate(makeSheet('Shop A3'), 'Shop A3');
    const path = await saveTemplate(opfs, t);
    expect(path).toBe('templates/shop-a3.zitpl');

    const listed = await listTemplates(opfs);
    expect(listed).toEqual(['templates/shop-a3.zitpl']);

    const back = await loadTemplate(opfs, path);
    expect(back).toEqual(t);
    expect(back.titleBlock).toEqual({ drawnBy: 'YL', revision: 'A' });
  });

  it('listTemplates ignores non-template files and sorts', async () => {
    const opfs = fakeOpfs();
    await opfs.write('drawings/x.zipt', new Uint8Array([1]));
    await saveTemplate(opfs, exportDrawingTemplate(makeSheet('Bravo'), 'Bravo'));
    await saveTemplate(opfs, exportDrawingTemplate(makeSheet('Alpha'), 'Alpha'));
    const listed = await listTemplates(opfs);
    expect(listed).toEqual(['templates/alpha.zitpl', 'templates/bravo.zitpl']);
  });
});
