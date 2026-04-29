// @vitest-environment node
import { describe, expect, it, beforeEach } from 'vitest';
import { packAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import type { AssemblyDocument } from '@zilventor/shared';
import { SubAssemblyCache } from '../SubAssemblyCache';

function makeDoc(id: string, name: string, components: AssemblyDocument['components'] = []): AssemblyDocument {
  return {
    id,
    name,
    units: 'mm',
    parameters: {},
    components,
    constraints: [],
    groundedComponentPaths: [],
    colors: {},
    bomItemNumbers: {},
    colorOverrides: {},
  };
}

class MemOpfs {
  private files = new Map<string, Uint8Array>();
  async write(path: string, bytes: Uint8Array) {
    this.files.set(path, bytes);
  }
  async read(path: string) {
    const b = this.files.get(path);
    if (!b) throw new Error('ENOENT');
    return b;
  }
  async exists(path: string) {
    return this.files.has(path);
  }
  async delete(path: string) {
    this.files.delete(path);
  }
}

describe('SubAssemblyCache', () => {
  let opfs: MemOpfs;
  beforeEach(() => {
    opfs = new MemOpfs();
  });

  it('loadSubAssembly returns ok entry for an existing .ziasm', async () => {
    const drawerDoc = makeDoc('drawer-id', 'drawer');
    await opfs.write('drawer.ziasm', await packAssembly(drawerDoc, new Uint8Array()));

    const cache = new SubAssemblyCache(opfs as any);
    const entry = await cache.loadSubAssembly('drawer.ziasm');
    expect(entry.kind).toBe('ok');
    if (entry.kind === 'ok') expect(entry.doc.name).toBe('drawer');
  });

  it('loadSubAssembly returns missing entry when path is absent', async () => {
    const cache = new SubAssemblyCache(opfs as any);
    const entry = await cache.loadSubAssembly('missing.ziasm');
    expect(entry.kind).toBe('missing');
  });

  it('caches the doc on subsequent calls', async () => {
    const drawerDoc = makeDoc('drawer-id', 'drawer');
    await opfs.write('drawer.ziasm', await packAssembly(drawerDoc, new Uint8Array()));
    const cache = new SubAssemblyCache(opfs as any);
    const a = await cache.loadSubAssembly('drawer.ziasm');
    const b = await cache.loadSubAssembly('drawer.ziasm');
    expect(b).toBe(a);
  });

  it('invalidate drops the cache entry', async () => {
    const drawerDoc = makeDoc('drawer-id', 'drawer');
    await opfs.write('drawer.ziasm', await packAssembly(drawerDoc, new Uint8Array()));
    const cache = new SubAssemblyCache(opfs as any);
    const a = await cache.loadSubAssembly('drawer.ziasm');
    cache.invalidate('drawer.ziasm');
    const b = await cache.loadSubAssembly('drawer.ziasm');
    expect(b).not.toBe(a);
    expect(b.kind).toBe('ok');
  });
});
