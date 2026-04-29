// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { PlaceComponentCommand } from '../PlaceComponentCommand';
import { packAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import type { AssemblyDocument } from '@zilventor/shared';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
  async read(p: string) {
    const b = this.files.get(p);
    if (!b) throw new Error('ENOENT');
    return b;
  }
  async exists(p: string) { return this.files.has(p); }
}

function makeDoc(name: string, components: AssemblyDocument['components'] = []): AssemblyDocument {
  return {
    id: name, name, units: 'mm', parameters: {},
    components, constraints: [], groundedComponentPaths: [],
    colors: {}, bomItemNumbers: {}, colorOverrides: {},
  };
}

describe('PlaceComponentCommand', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeDoc('a') });
  });

  it('apply() adds a ComponentInstance to the active assembly', async () => {
    const cmd = new PlaceComponentCommand({ partPath: 'leg.zipt' });
    await cmd.apply();
    const s = useAppStore.getState();
    expect(s.activeAssembly?.components).toHaveLength(1);
    expect(s.activeAssembly?.components[0]!.partPath).toBe('leg.zipt');
  });

  it('revert() removes the placed component', async () => {
    const cmd = new PlaceComponentCommand({ partPath: 'leg.zipt' });
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly?.components).toHaveLength(0);
  });

  it('refuses to place a .ziasm that would create a cycle and sets a status message', async () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeDoc('top') });
    const opfs = new MemOpfs();
    // candidate.ziasm contains a component pointing back at top.ziasm -> cycle
    const candidate = makeDoc('candidate', [
      { id: 'inner', partPath: 'top.ziasm',
        position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ]);
    await opfs.write('candidate.ziasm', await packAssembly(candidate, new Uint8Array()));
    const cmd = new PlaceComponentCommand({ partPath: 'candidate.ziasm', opfs: opfs as any });
    await cmd.apply();
    const s = useAppStore.getState();
    expect(s.activeAssembly?.components).toHaveLength(0);
    expect(s.statusMessage.toLowerCase()).toContain('cycle');
  });

  it('places a non-cyclic .ziasm normally', async () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeDoc('top') });
    const opfs = new MemOpfs();
    const drawer = makeDoc('drawer');
    await opfs.write('drawer.ziasm', await packAssembly(drawer, new Uint8Array()));
    const cmd = new PlaceComponentCommand({ partPath: 'drawer.ziasm', opfs: opfs as any });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly?.components).toHaveLength(1);
  });
});
