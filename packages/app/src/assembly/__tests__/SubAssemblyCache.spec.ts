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

describe('SubAssemblyCache.loadSubAssemblyTree', () => {
  let opfs: MemOpfs;
  beforeEach(() => {
    opfs = new MemOpfs();
  });

  it('walks transitively and caches every reachable .ziasm', async () => {
    const inner = makeDoc('inner-id', 'inner', [
      { id: 'panel', partPath: 'panel.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ]);
    const middle = makeDoc('mid-id', 'middle', [
      { id: 'i1', partPath: 'inner.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ]);
    const top = makeDoc('top-id', 'top', [
      { id: 'm1', partPath: 'middle.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ]);
    await opfs.write('inner.ziasm', await packAssembly(inner, new Uint8Array()));
    await opfs.write('middle.ziasm', await packAssembly(middle, new Uint8Array()));

    const cache = new SubAssemblyCache(opfs as any);
    await cache.loadSubAssemblyTree(top);
    expect(cache.get('middle.ziasm')?.kind).toBe('ok');
    expect(cache.get('inner.ziasm')?.kind).toBe('ok');
  });

  it('marks a self-referential .ziasm as cycle on second encounter', async () => {
    const a = makeDoc('a-id', 'a', [
      { id: 'self', partPath: 'a.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ]);
    await opfs.write('a.ziasm', await packAssembly(a, new Uint8Array()));
    const cache = new SubAssemblyCache(opfs as any);
    const top = makeDoc('top-id', 'top', [
      { id: 'p1', partPath: 'a.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ]);
    await cache.loadSubAssemblyTree(top);
    expect(cache.get('a.ziasm')?.kind).toBe('ok');
    expect(cache.diagnostics().some((d) => d.kind === 'cycle' && d.partPath === 'a.ziasm')).toBe(true);
  });

  it('marks a transitive cycle (A -> B -> A) as cycle', async () => {
    const a = makeDoc('a-id', 'a', [
      { id: 'p', partPath: 'b.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ]);
    const b = makeDoc('b-id', 'b', [
      { id: 'p', partPath: 'a.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ]);
    await opfs.write('a.ziasm', await packAssembly(a, new Uint8Array()));
    await opfs.write('b.ziasm', await packAssembly(b, new Uint8Array()));
    const cache = new SubAssemblyCache(opfs as any);
    const top = makeDoc('top', 'top', [
      { id: 't1', partPath: 'a.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ]);
    await cache.loadSubAssemblyTree(top);
    expect(cache.diagnostics().some((d) => d.kind === 'cycle' && d.partPath === 'a.ziasm')).toBe(true);
  });

  it('loadSubAssemblyTree clears prior diagnostics on each call', async () => {
    const a = makeDoc('a-id', 'a', [
      { id: 'self', partPath: 'a.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ]);
    await opfs.write('a.ziasm', await packAssembly(a, new Uint8Array()));
    const cache = new SubAssemblyCache(opfs as any);
    const top = makeDoc('top', 'top', [
      { id: 'p', partPath: 'a.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ]);
    await cache.loadSubAssemblyTree(top);
    expect(cache.diagnostics().length).toBeGreaterThan(0);
    cache.invalidate('a.ziasm');
    await cache.loadSubAssemblyTree(top);
    // After re-walk, diagnostics list should reflect only the latest walk's findings
    // (no double-count of the same cycle from the previous walk)
    const cycleHits = cache.diagnostics().filter((d) => d.kind === 'cycle' && d.partPath === 'a.ziasm');
    expect(cycleHits).toHaveLength(1);
  });
});
