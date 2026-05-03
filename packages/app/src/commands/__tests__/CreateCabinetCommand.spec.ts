// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { CreateCabinetCommand } from '../CreateCabinetCommand';
import type { OpfsLike } from '../../assembly/SubAssemblyCache';
import { useAppStore } from '../../store/useAppStore';
import type { AssemblyDocument, MaterialEntry } from '@zilventor/shared';

class MemOpfs implements OpfsLike {
  files = new Map<string, Uint8Array>();
  async exists(p: string) { return this.files.has(p); }
  async read(p: string) { const b = this.files.get(p); if (!b) throw new Error(`no ${p}`); return b; }
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
  async delete(p: string) { this.files.delete(p); }
  async list(): Promise<string[]> { return Array.from(this.files.keys()); }
}

const carcass: MaterialEntry = { id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' };
const back: MaterialEntry = { id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' };

function seedAssembly(name = 'Project'): AssemblyDocument {
  const doc: AssemblyDocument = {
    id: 'A1', name, units: 'mm',
    parameters: {}, properties: {},
    components: [], constraints: [],
    groundedComponentPaths: [], colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [carcass, back],
  };
  useAppStore.getState().setActiveDocument({ kind: 'assembly', document: doc });
  return doc;
}

const DEFAULTS = {
  name: 'Base Cabinet 1',
  width: 600, depth: 560, height: 720,
  toekickHeight: 100, toekickSetback: 50, shelfCount: 1,
  carcassMaterialId: 'm-birch-18',
  backMaterialId: 'm-hb-6',
  bandMaterialId: null,
} as const;

describe('CreateCabinetCommand — name auto-suffix', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  it('writes the cabinet at the requested name when nothing collides', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'baseCabinet', params: { ...DEFAULTS }, opfs }).apply();
    const paths = await opfs.list();
    expect(paths).toContain('Base Cabinet 1.ziasm');
    expect(paths).toContain('Base Cabinet 1 - Left Side.zipt');
  });

  it('auto-suffixes to "Base Cabinet 2" when "Base Cabinet 1.ziasm" exists', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await opfs.write('Base Cabinet 1.ziasm', new Uint8Array([1]));
    await new CreateCabinetCommand({ template: 'baseCabinet', params: { ...DEFAULTS }, opfs }).apply();
    const paths = await opfs.list();
    expect(paths).toContain('Base Cabinet 2.ziasm');
    expect(paths).toContain('Base Cabinet 2 - Left Side.zipt');
    expect(await opfs.read('Base Cabinet 1.ziasm')).toEqual(new Uint8Array([1]));
  });
});

describe('CreateCabinetCommand — happy path', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  it('writes 1 .ziasm + 7 .zipt files for default params (1 shelf)', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'baseCabinet', params: { ...DEFAULTS }, opfs }).apply();
    const paths = (await opfs.list()).sort();
    expect(paths).toEqual([
      'Base Cabinet 1 - Back.zipt',
      'Base Cabinet 1 - Bottom.zipt',
      'Base Cabinet 1 - Left Side.zipt',
      'Base Cabinet 1 - Right Side.zipt',
      'Base Cabinet 1 - Shelf 1.zipt',
      'Base Cabinet 1 - Toekick.zipt',
      'Base Cabinet 1 - Top.zipt',
      'Base Cabinet 1.ziasm',
    ]);
  });

  it('adds exactly one component to the active assembly referencing the new .ziasm', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'baseCabinet', params: { ...DEFAULTS }, opfs }).apply();
    const asm = useAppStore.getState().activeAssembly!;
    expect(asm.components).toHaveLength(1);
    expect(asm.components[0].partPath).toBe('Base Cabinet 1.ziasm');
    expect(asm.components[0].position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('shelfCount=0 emits 6 .zipts (no shelf)', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({
      template: 'baseCabinet',
      params: { ...DEFAULTS, name: 'BC noShelves', shelfCount: 0 },
      opfs,
    }).apply();
    const paths = (await opfs.list()).filter((p) => p.endsWith('.zipt'));
    expect(paths).toHaveLength(6);
    expect(paths.some((p) => p.includes('Shelf'))).toBe(false);
  });

  it('toekickHeight=0 emits 6 .zipts (no toekick)', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({
      template: 'baseCabinet',
      params: { ...DEFAULTS, name: 'BC flat', toekickHeight: 0, toekickSetback: 0 },
      opfs,
    }).apply();
    const paths = (await opfs.list()).filter((p) => p.endsWith('.zipt'));
    expect(paths).toHaveLength(6);
    expect(paths.some((p) => p.includes('Toekick'))).toBe(false);
  });
});

describe('CreateCabinetCommand — revert', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  it('removes the placed component and deletes all 8 written files', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    const cmd = new CreateCabinetCommand({ template: 'baseCabinet', params: { ...DEFAULTS }, opfs });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly!.components).toHaveLength(1);
    expect((await opfs.list()).length).toBe(8);

    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.components).toHaveLength(0);
    expect(await opfs.list()).toEqual([]);
  });
});

describe('CreateCabinetCommand — mid-flight rollback', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  it('rolls back already-written files when a later write fails', async () => {
    seedAssembly();
    let writeCount = 0;
    const opfs = new MemOpfs();
    const realWrite = opfs.write.bind(opfs);
    opfs.write = async (p: string, b: Uint8Array) => {
      writeCount++;
      if (writeCount === 4) throw new Error('disk full');
      return realWrite(p, b);
    };
    const cmd = new CreateCabinetCommand({ template: 'baseCabinet', params: { ...DEFAULTS }, opfs });
    await expect(cmd.apply()).rejects.toThrow('disk full');
    expect(await opfs.list()).toEqual([]);
    expect(useAppStore.getState().activeAssembly!.components).toHaveLength(0);
  });
});
