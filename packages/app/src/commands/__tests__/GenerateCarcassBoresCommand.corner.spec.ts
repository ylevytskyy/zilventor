// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { CreateCabinetCommand } from '../CreateCabinetCommand';
import { GenerateCarcassBoresCommand } from '../GenerateCarcassBoresCommand';
import { useAppStore } from '../../store/useAppStore';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import type { AssemblyDocument, BoreOp, MaterialEntry } from '@zilventor/shared';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async exists(p: string) { return this.files.has(p); }
  async read(p: string) { const b = this.files.get(p); if (!b) throw new Error(`no ${p}`); return b; }
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
  async delete(p: string) { this.files.delete(p); }
  async list(): Promise<string[]> { return Array.from(this.files.keys()); }
}

const carcass: MaterialEntry = { id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' };
const back: MaterialEntry = { id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' };

function seedAssembly(): void {
  const doc: AssemblyDocument = {
    id: 'A1', name: 'Project', units: 'mm',
    parameters: {}, properties: {},
    components: [], constraints: [], groundedComponentPaths: [],
    colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [carcass, back],
    hardware: [],
  };
  useAppStore.getState().setActiveDocument({ kind: 'assembly', document: doc });
}

const CORNER = {
  name: 'Corner Cab',
  width1: 900, depth1: 350, width2: 600, depth2: 350, height: 720,
  carcassMaterialId: 'm-birch-18',
  backMaterialId: 'm-hb-6',
  bandMaterialId: null,
} as const;

const PARAMS = { endSetback: 60, maxSpacing: 250, minCount: 2, confirmat: true, minifix: false, dowel: false };

async function boresOf(opfs: MemOpfs, path: string): Promise<BoreOp[]> {
  const project = await unpackProject(await opfs.read(path));
  const doc = (project.manifest as { document: { bores?: BoreOp[] } }).document;
  return doc.bores ?? [];
}

describe('GenerateCarcassBoresCommand — L-corner cabinet (1a.2.4 guard)', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  it('processes a corner cabinet without crashing', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'cornerCabinet', params: { ...CORNER }, opfs }).apply();
    // The non-rectangular L arrangement + cornerPost must not crash auto-boring.
    await expect(
      new GenerateCarcassBoresCommand({ params: PARAMS, opfs }).apply(),
    ).resolves.toBeUndefined();
  });

  it('never bores the corner post (it is not a side/end joint member)', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'cornerCabinet', params: { ...CORNER }, opfs }).apply();
    await new GenerateCarcassBoresCommand({ params: PARAMS, opfs }).apply();
    expect(await boresOf(opfs, 'Corner Cab - Corner Post.zipt')).toHaveLength(0);
  });

  it('never bores the back panels', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'cornerCabinet', params: { ...CORNER }, opfs }).apply();
    await new GenerateCarcassBoresCommand({ params: PARAMS, opfs }).apply();
    expect(await boresOf(opfs, 'Corner Cab - Back 1.zipt')).toHaveLength(0);
    expect(await boresOf(opfs, 'Corner Cab - Back 2.zipt')).toHaveLength(0);
  });
});
