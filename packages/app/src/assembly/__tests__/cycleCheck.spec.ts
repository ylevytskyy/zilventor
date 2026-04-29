// @vitest-environment node
import { describe, expect, it, beforeEach } from 'vitest';
import { packAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import type { AssemblyDocument } from '@zilventor/shared';
import { wouldCreateCycle } from '../cycleCheck';

function doc(name: string, components: AssemblyDocument['components'] = []): AssemblyDocument {
  return {
    id: name,
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
  files = new Map<string, Uint8Array>();
  async write(p: string, b: Uint8Array) {
    this.files.set(p, b);
  }
  async read(p: string) {
    const b = this.files.get(p);
    if (!b) throw new Error('ENOENT');
    return b;
  }
  async exists(p: string) {
    return this.files.has(p);
  }
}

describe('wouldCreateCycle', () => {
  let opfs: MemOpfs;
  beforeEach(() => {
    opfs = new MemOpfs();
  });

  it('returns false for a candidate with no transitive references', async () => {
    await opfs.write('drawer.ziasm', await packAssembly(doc('drawer'), new Uint8Array()));
    expect(await wouldCreateCycle(doc('top'), 'top.ziasm', 'drawer.ziasm', opfs as any)).toBe(false);
  });

  it('returns true when candidate transitively references the active doc', async () => {
    const drawer = doc('drawer', [
      { id: 'inner', partPath: 'top.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ]);
    await opfs.write('drawer.ziasm', await packAssembly(drawer, new Uint8Array()));
    expect(await wouldCreateCycle(doc('top'), 'top.ziasm', 'drawer.ziasm', opfs as any)).toBe(true);
  });

  it('returns true on direct self-cycle', async () => {
    expect(await wouldCreateCycle(doc('top'), 'top.ziasm', 'top.ziasm', opfs as any)).toBe(true);
  });

  it('returns false when candidate file is missing', async () => {
    expect(await wouldCreateCycle(doc('top'), 'top.ziasm', 'absent.ziasm', opfs as any)).toBe(false);
  });
});
