// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CreateCabinetCommand } from '../CreateCabinetCommand';
import type { OpfsLike } from '../../assembly/SubAssemblyCache';
import { useAppStore } from '../../store/useAppStore';
import type { AssemblyDocument, MaterialEntry, PartDocument, Feature } from '@zilventor/shared';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import type { PanelRole } from '@zilventor/shared';

// Only `buildBaseCabinet` is overridden, and only for the sentinel cabinet name
// `'Pose Passthrough'` used by the pose-threading tests below — every other name
// (including all pre-existing tests in this file) falls through to the real
// implementation unmodified.
const TEST_POSE = {
  translation: { x: 1, y: 2, z: 3 },
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
};
vi.mock('@zilventor/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zilventor/shared')>();
  return {
    ...actual,
    buildBaseCabinet: (
      params: Parameters<typeof actual.buildBaseCabinet>[0],
      registry: Parameters<typeof actual.buildBaseCabinet>[1],
    ) => {
      const built = actual.buildBaseCabinet(params, registry);
      if (params.name === 'Pose Passthrough') {
        return {
          ...built,
          layout: built.layout.map((c, i) => (i === 0 ? { ...c, pose: TEST_POSE } : c)),
        };
      }
      if (params.name === 'Pose Absent') {
        // Slice 3 gave every real template entry a pose; strip them so the
        // absence-stays-absent contract can still be exercised.
        return {
          ...built,
          layout: built.layout.map(({ pose: _pose, ...rest }) => rest),
        };
      }
      return built;
    },
  };
});

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
    hardware: [],
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
    expect(asm.components[0]!.partPath).toBe('Base Cabinet 1.ziasm');
    expect(asm.components[0]!.position).toEqual({ x: 0, y: 0, z: 0 });
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

describe('CreateCabinetCommand — cabinet type routing', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  it('wall type emits a Hanging Rail panel, no Toekick, and stamps the hangingRail role', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({
      template: 'baseCabinet',
      params: { ...DEFAULTS, name: 'Wall Cab', cabinetType: 'wall', toekickHeight: 0, toekickSetback: 0 },
      opfs,
    }).apply();
    const paths = (await opfs.list()).filter((p) => p.endsWith('.zipt'));
    expect(paths.some((p) => p.includes('Hanging Rail'))).toBe(true);
    expect(paths.some((p) => p.includes('Toekick'))).toBe(false);

    const project = await unpackProject(await opfs.read('Wall Cab.ziasm'));
    const doc = (project.manifest as { document: { components: Array<{ partPath: string; role?: PanelRole }> } }).document;
    const roleByPath = new Map(doc.components.map((c) => [c.partPath, c.role]));
    expect(roleByPath.get('Wall Cab - Hanging Rail.zipt')).toBe('hangingRail');
  });

  it('tall type is a base carcass (Toekick present, no Hanging Rail)', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({
      template: 'baseCabinet',
      params: { ...DEFAULTS, name: 'Tall Cab', cabinetType: 'tall', height: 2100 },
      opfs,
    }).apply();
    const paths = (await opfs.list()).filter((p) => p.endsWith('.zipt'));
    expect(paths.some((p) => p.includes('Toekick'))).toBe(true);
    expect(paths.some((p) => p.includes('Hanging Rail'))).toBe(false);
  });
});

describe('CreateCabinetCommand — corner cabinet template', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  const CORNER = {
    name: 'Corner Cab',
    width1: 900, depth1: 350, width2: 600, depth2: 350, height: 720,
    carcassMaterialId: 'm-birch-18',
    backMaterialId: 'm-hb-6',
    bandMaterialId: null,
  } as const;

  it('writes the L-corner panels including a Corner Post and stamps the cornerPost role', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'cornerCabinet', params: { ...CORNER }, opfs }).apply();
    const paths = (await opfs.list()).filter((p) => p.endsWith('.zipt'));
    // 9 carcass panels for the L-unit.
    expect(paths).toHaveLength(9);
    expect(paths.some((p) => p.includes('Corner Post'))).toBe(true);
    expect(paths.some((p) => p.includes('Bottom 2'))).toBe(true);

    const project = await unpackProject(await opfs.read('Corner Cab.ziasm'));
    const doc = (project.manifest as { document: { components: Array<{ partPath: string; role?: PanelRole }> } }).document;
    const roleByPath = new Map(doc.components.map((c) => [c.partPath, c.role]));
    expect(roleByPath.get('Corner Cab - Corner Post.zipt')).toBe('cornerPost');
    expect(doc.components).toHaveLength(9);
    for (const c of doc.components) expect(c.role).toBeDefined();
  });
});

describe('CreateCabinetCommand — persists ComponentInstance.role', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  it('stamps each cabinet sub-component instance with its panel role', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'baseCabinet', params: { ...DEFAULTS }, opfs }).apply();

    // The placed top-level component is the .ziasm; read it back and inspect its instances.
    const ziasmBytes = await opfs.read('Base Cabinet 1.ziasm');
    const project = await unpackProject(ziasmBytes);
    const doc = (project.manifest as { document: { components: Array<{ partPath: string; role?: PanelRole }> } }).document;

    const roleByPath = new Map(doc.components.map((c) => [c.partPath, c.role]));
    expect(roleByPath.get('Base Cabinet 1 - Left Side.zipt')).toBe('leftSide');
    expect(roleByPath.get('Base Cabinet 1 - Right Side.zipt')).toBe('rightSide');
    expect(roleByPath.get('Base Cabinet 1 - Bottom.zipt')).toBe('bottom');
    expect(roleByPath.get('Base Cabinet 1 - Top.zipt')).toBe('top');
    expect(roleByPath.get('Base Cabinet 1 - Back.zipt')).toBe('back');
    expect(roleByPath.get('Base Cabinet 1 - Toekick.zipt')).toBe('toekick');
    expect(roleByPath.get('Base Cabinet 1 - Shelf 1.zipt')).toBe('shelf');
  });

  it('every component instance has a defined role (no undefined)', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'baseCabinet', params: { ...DEFAULTS }, opfs }).apply();
    const project = await unpackProject(await opfs.read('Base Cabinet 1.ziasm'));
    const doc = (project.manifest as { document: { components: Array<{ role?: PanelRole }> } }).document;
    expect(doc.components.length).toBe(7);
    for (const c of doc.components) expect(c.role).toBeDefined();
  });
});

describe('CreateCabinetCommand — blindCornerCabinet template', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  const BLIND = {
    name: 'Blind Cab 1',
    width: 900, depth: 560, height: 720,
    toekickHeight: 100, toekickSetback: 60,
    openingWidth: 450, blindSide: 'left' as const,
    shelfCount: 0,
    carcassMaterialId: 'm-birch-18',
    backMaterialId: 'm-hb-6',
    bandMaterialId: null,
  };

  it('writes 8 .zipt + 1 .ziasm for blindCornerCabinet', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'blindCornerCabinet', params: BLIND, opfs }).apply();
    const ziptCount = (await opfs.list()).filter(p => p.endsWith('.zipt') && !p.startsWith('hardware/')).length;
    expect(ziptCount).toBe(8); // Left+Right+Bottom+Top+Back+Toekick+BlindFiller+Door
    expect(await opfs.list()).toContain('Blind Cab 1.ziasm');
  });

  it('door .zipt contains bores (cup bores)', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'blindCornerCabinet', params: BLIND, opfs }).apply();
    const doorBytes = await opfs.read('Blind Cab 1 - Door.zipt');
    const project = await unpackProject(doorBytes);
    const doc = (project.manifest as { document: { bores?: unknown[] } }).document;
    expect(doc.bores).toBeDefined();
    expect((doc.bores!).length).toBeGreaterThan(0);
  });

  it('hinge side panel .zipt contains plate bores', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'blindCornerCabinet', params: BLIND, opfs }).apply();
    // blindSide=left → live side = right → Right Side
    const bytes = await opfs.read('Blind Cab 1 - Right Side.zipt');
    const project = await unpackProject(bytes);
    const doc = (project.manifest as { document: { bores?: unknown[] } }).document;
    expect(doc.bores).toBeDefined();
    expect((doc.bores!).length).toBeGreaterThan(0);
  });

  it('cabinet .ziasm has hardware component paths for hinges', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'blindCornerCabinet', params: BLIND, opfs }).apply();
    const project = await unpackProject(await opfs.read('Blind Cab 1.ziasm'));
    const doc = (project.manifest as { document: { components: Array<{ partPath: string }> } }).document;
    const hingeComponents = doc.components.filter(c => c.partPath.startsWith('hardware/'));
    expect(hingeComponents.length).toBeGreaterThan(0);
    expect(hingeComponents.every(c => c.partPath === 'hardware/hinge-35mm-cup-full.zipt')).toBe(true);
  });

  it('revert removes the placed component and all written files', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    const cmd = new CreateCabinetCommand({ template: 'blindCornerCabinet', params: BLIND, opfs });
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.components).toHaveLength(0);
    expect(await opfs.list()).toEqual([]);
  });

  it('cabinet-written hardware/<sku>.zipt contains sketch+extrude+hardware features (full renderable part)', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'blindCornerCabinet', params: BLIND, opfs }).apply();

    const bytes = await opfs.read('hardware/hinge-35mm-cup-full.zipt');
    const { manifest } = await unpackProject(bytes);
    const doc = (manifest as { document: PartDocument }).document;
    const tree: Feature[] = doc.featureTree;

    // Full renderable part: 7 origin + sketch + extrude + hardware = 10 features.
    expect(tree).toHaveLength(10);
    expect(tree.some(f => f.kind === 'sketch')).toBe(true);
    expect(tree.some(f => f.kind === 'extrude')).toBe(true);
    expect(tree.some(f => f.kind === 'hardware')).toBe(true);
  });
});

describe('CreateCabinetCommand — diagonalCornerCabinet template', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  // wallWidth1=900, returnDepth=560 → diagLen=340*sqrt(2)≈480mm → doorW≈376mm > 100mm threshold
  const DIAG = {
    name: 'Diag Cab 1',
    wallWidth1: 900, wallWidth2: 900,
    returnDepth1: 560, returnDepth2: 560,
    height: 720, toekickHeight: 100, toekickSetback: 60,
    stileWidth: 50,
    carcassMaterialId: 'm-birch-18',
    backMaterialId: 'm-hb-6',
    bandMaterialId: null,
  };

  it('writes 11 .zipt + 1 .ziasm for diagonalCornerCabinet', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'diagonalCornerCabinet', params: DIAG, opfs }).apply();
    const ziptCount = (await opfs.list()).filter(p => p.endsWith('.zipt') && !p.startsWith('hardware/')).length;
    expect(ziptCount).toBe(11);
    expect(await opfs.list()).toContain('Diag Cab 1.ziasm');
  });

  it('door .zipt contains cup bores', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'diagonalCornerCabinet', params: DIAG, opfs }).apply();
    const project = await unpackProject(await opfs.read('Diag Cab 1 - Door.zipt'));
    const doc = (project.manifest as { document: { bores?: unknown[] } }).document;
    expect(doc.bores).toBeDefined();
    expect(doc.bores!.length).toBeGreaterThan(0);
  });

  it('hinge SKU appears as assembly component', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'diagonalCornerCabinet', params: DIAG, opfs }).apply();
    const project = await unpackProject(await opfs.read('Diag Cab 1.ziasm'));
    const doc = (project.manifest as { document: { components: Array<{ partPath: string }> } }).document;
    expect(doc.components.some(c => c.partPath === 'hardware/hinge-35mm-cup-full.zipt')).toBe(true);
  });

  it('revert cleans up all written files', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    const cmd = new CreateCabinetCommand({ template: 'diagonalCornerCabinet', params: DIAG, opfs });
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.components).toHaveLength(0);
    expect(await opfs.list()).toEqual([]);
  });
});

describe('CreateCabinetCommand — layout pose threading', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  it('threads a layout pose into the built ComponentInstance when present', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({
      template: 'baseCabinet',
      params: { ...DEFAULTS, name: 'Pose Passthrough' },
      opfs,
    }).apply();

    const project = await unpackProject(await opfs.read('Pose Passthrough.ziasm'));
    const doc = (project.manifest as { document: { components: Array<{ partPath: string; pose?: unknown }> } }).document;
    const leftSide = doc.components.find((c) => c.partPath === 'Pose Passthrough - Left Side.zipt');
    expect(leftSide?.pose).toEqual(TEST_POSE);
  });

  it('leaves pose truly absent (no key) when the layout entry has none', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({
      template: 'baseCabinet',
      params: { ...DEFAULTS, name: 'Pose Absent' },
      opfs,
    }).apply();

    const project = await unpackProject(await opfs.read('Pose Absent.ziasm'));
    const doc = (project.manifest as { document: { components: Array<{ partPath: string }> } }).document;
    const leftSide = doc.components.find((c) => c.partPath === 'Pose Absent - Left Side.zipt')!;
    expect('pose' in leftSide).toBe(false);
  });
});
