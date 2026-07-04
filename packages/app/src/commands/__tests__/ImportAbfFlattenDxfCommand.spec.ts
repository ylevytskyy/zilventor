// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { ImportAbfFlattenDxfCommand } from '../ImportAbfFlattenDxfCommand';
import type { AbfPanelRecord } from '@zilventor/shared/src/dxf/abfPanelExtraction';
import type { AbfImportGroupSelection } from '../../shell/ImportAbfFlattenDxfDialog';

// ---------- helpers ----------------------------------------------------------

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
  async read(p: string) {
    const b = this.files.get(p);
    if (!b) throw new Error(`ENOENT: ${p}`);
    return b;
  }
  async exists(p: string) { return this.files.has(p); }
  async delete(p: string) { this.files.delete(p); }
  async listAll() { return [...this.files.keys()]; }
}

const DOOR_PANEL: AbfPanelRecord = {
  name: '__4. Дверка',
  materialGroup: { token: 'AUTO_THICKNESS_18', material: 'AUTO', thicknessMm: 18 },
  length: 600,
  width: 400,
  rectangular: true,
  outline: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 400 }, { x: 0, y: 400 }],
  circles: [
    {
      kind: 'bore', diameter: 35, depth: 13, faceRole: 'Bottom',
      role: 'hingeCup', connectorKind: 'hinge', u: 50, v: 60,
      bestEffort: false, sku: '96053',
    },
    { kind: 'reference', diameter: 5, x: 20, y: 30 },
  ],
};

const PLAIN_PANEL: AbfPanelRecord = {
  name: '__9. Дно',
  materialGroup: { token: 'SREE_PEARLS_2_THICKNESS_18', material: 'SREE_PEARLS_2', thicknessMm: 18 },
  length: 500,
  width: 300,
  rectangular: true,
  outline: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 300 }, { x: 0, y: 300 }],
  circles: [],
};

const NON_RECT_PANEL: AbfPanelRecord = { ...PLAIN_PANEL, name: '__13. ЗАД', rectangular: false };

const SELECTIONS: AbfImportGroupSelection[] = [
  { groupToken: 'AUTO_THICKNESS_18', materialId: 'mat-auto', thickness: 18 },
  { groupToken: 'SREE_PEARLS_2_THICKNESS_18', materialId: 'mat-sree', thickness: 18 },
];

function priorAssembly() {
  return {
    kind: 'assembly' as const,
    document: {
      id: 'prior-asm', name: 'PriorAsm', units: 'mm' as const, parameters: {}, components: [],
      constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {},
      cutListItemNumbers: {}, colorOverrides: {}, properties: {}, materials: [], hardware: [],
    },
  };
}

describe('ImportAbfFlattenDxfCommand — happy path', () => {
  let opfs: MemOpfs;

  beforeEach(() => {
    opfs = new MemOpfs();
    useAppStore.getState().setActiveDocument(priorAssembly());
  });

  it('apply: activeDocument becomes a brand-new assembly with N components (one per record)', async () => {
    const cmd = new ImportAbfFlattenDxfCommand({
      records: [DOOR_PANEL, PLAIN_PANEL],
      selections: SELECTIONS,
      opfs: opfs as any,
    });
    await cmd.apply();

    const { activeDocument } = useAppStore.getState();
    expect(activeDocument?.kind).toBe('assembly');
    if (activeDocument?.kind !== 'assembly') throw new Error('guard');
    expect(activeDocument.document.components).toHaveLength(2);
    expect(activeDocument.document.id).not.toBe('prior-asm');
  });

  it('apply: components are placed at origin/identity pose with partPaths <panel name>.zipt', async () => {
    const cmd = new ImportAbfFlattenDxfCommand({
      records: [DOOR_PANEL, PLAIN_PANEL],
      selections: SELECTIONS,
      opfs: opfs as any,
    });
    await cmd.apply();

    const { activeDocument } = useAppStore.getState();
    if (activeDocument?.kind !== 'assembly') throw new Error('guard');
    const paths = activeDocument.document.components.map((c) => c.partPath).sort();
    expect(paths).toEqual(['__4. Дверка.zipt', '__9. Дно.zipt'].sort());
    for (const c of activeDocument.document.components) {
      expect(c.position).toEqual({ x: 0, y: 0, z: 0 });
      expect(c.rotation).toEqual({ rx: 0, ry: 0, rz: 0 });
      expect(c.visible).toBe(true);
    }
  });

  it('apply: writes one .zipt archive per record to OPFS', async () => {
    const writeSpy = vi.spyOn(opfs, 'write');
    const cmd = new ImportAbfFlattenDxfCommand({
      records: [DOOR_PANEL, PLAIN_PANEL],
      selections: SELECTIONS,
      opfs: opfs as any,
    });
    await cmd.apply();
    expect(writeSpy).toHaveBeenCalledTimes(2);
    expect(opfs.files.size).toBe(2);
  });

  it('apply: summary counts bores imported, reference-only circles, and non-rectangular panels', async () => {
    const cmd = new ImportAbfFlattenDxfCommand({
      records: [DOOR_PANEL, PLAIN_PANEL, NON_RECT_PANEL],
      selections: SELECTIONS,
      opfs: opfs as any,
    });
    await cmd.apply();
    expect(cmd.summary).toEqual({
      partsImported: 3,
      boresImported: 1,
      referenceCircles: 1,
      nonRectangularPanels: 1,
    });
  });

  it('apply: status message reports bore-vs-reference-geometry counts', async () => {
    const setStatusSpy = vi.spyOn(useAppStore.getState(), 'setStatus');
    const cmd = new ImportAbfFlattenDxfCommand({
      records: [DOOR_PANEL],
      selections: SELECTIONS,
      opfs: opfs as any,
    });
    await cmd.apply();
    expect(setStatusSpy).toHaveBeenCalledTimes(1);
    const msg = setStatusSpy.mock.calls[0]![0] as string;
    expect(msg).toMatch(/1 bore/i);
    expect(msg).toMatch(/1.*reference/i);
  });

  it('apply: dedupes OPFS name collisions against existing files', async () => {
    await opfs.write('__4. Дверка.zipt', new Uint8Array([9, 9, 9]));
    const cmd = new ImportAbfFlattenDxfCommand({
      records: [DOOR_PANEL],
      selections: SELECTIONS,
      opfs: opfs as any,
    });
    await cmd.apply();
    const preExisting = await opfs.read('__4. Дверка.zipt');
    expect(preExisting).toEqual(new Uint8Array([9, 9, 9]));

    const { activeDocument } = useAppStore.getState();
    if (activeDocument?.kind !== 'assembly') throw new Error('guard');
    expect(activeDocument.document.components[0]!.partPath).toBe('__4. Дверка (2).zipt');
  });
});

// ---------- guard / error paths ----------------------------------------------

describe('ImportAbfFlattenDxfCommand — guards', () => {
  it('apply throws when records is empty', async () => {
    const cmd = new ImportAbfFlattenDxfCommand({ records: [], selections: SELECTIONS, opfs: new MemOpfs() as any });
    await expect(cmd.apply()).rejects.toThrow(/no panels/i);
  });

  it('apply throws when a record\'s material group has no matching dialog selection', async () => {
    const cmd = new ImportAbfFlattenDxfCommand({
      records: [DOOR_PANEL],
      selections: [],
      opfs: new MemOpfs() as any,
    });
    await expect(cmd.apply()).rejects.toThrow(/no dialog selection/i);
  });
});

// ---------- atomic abort on mid-loop OPFS failure -----------------------------

describe('ImportAbfFlattenDxfCommand — atomic abort', () => {
  it('apply rejects on a mid-loop OPFS write failure; cleans up only the parts written so far; does not switch activeDocument', async () => {
    const opfs = new MemOpfs();
    const writeSpy = vi.spyOn(opfs, 'write').mockImplementationOnce(async (p, b) => { opfs.files.set(p, b); })
      .mockImplementationOnce(async () => { throw new Error('disk full'); });
    const deleteSpy = vi.spyOn(opfs, 'delete');

    useAppStore.getState().setActiveDocument(priorAssembly());
    const prior = useAppStore.getState().activeDocument;

    const cmd = new ImportAbfFlattenDxfCommand({
      records: [DOOR_PANEL, PLAIN_PANEL],
      selections: SELECTIONS,
      opfs: opfs as any,
    });

    await expect(cmd.apply()).rejects.toThrow(/disk full/i);
    expect(writeSpy).toHaveBeenCalledTimes(2);
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith('__4. Дверка.zipt');
    expect(opfs.files.size).toBe(0);

    const { activeDocument } = useAppStore.getState();
    // activeDocument is unchanged — still the prior assembly, not the newly-built one
    // (a fresh assembly gets a random crypto.randomUUID() id, so `toEqual` alone proves it).
    expect(activeDocument).toEqual(prior);
  });
});

// ---------- revert -------------------------------------------------------------

describe('ImportAbfFlattenDxfCommand — revert', () => {
  it('revert restores the prior activeDocument and deletes all created OPFS parts', async () => {
    const opfs = new MemOpfs();
    const deleteSpy = vi.spyOn(opfs, 'delete');
    useAppStore.getState().setActiveDocument(priorAssembly());
    const prior = useAppStore.getState().activeDocument;

    const cmd = new ImportAbfFlattenDxfCommand({
      records: [DOOR_PANEL, PLAIN_PANEL],
      selections: SELECTIONS,
      opfs: opfs as any,
    });
    await cmd.apply();
    expect(opfs.files.size).toBe(2);

    await cmd.revert();
    expect(useAppStore.getState().activeDocument).toEqual(prior);
    expect(deleteSpy).toHaveBeenCalledTimes(2);
    expect(opfs.files.size).toBe(0);
  });

  it('apply -> revert -> apply (redo) succeeds and re-creates both parts', async () => {
    const opfs = new MemOpfs();
    useAppStore.getState().setActiveDocument(priorAssembly());

    const cmd = new ImportAbfFlattenDxfCommand({
      records: [DOOR_PANEL, PLAIN_PANEL],
      selections: SELECTIONS,
      opfs: opfs as any,
    });
    await cmd.apply();
    expect(useAppStore.getState().activeDocument?.kind).toBe('assembly');

    await cmd.revert();
    expect(useAppStore.getState().activeDocument?.kind).toBe('assembly');
    expect((useAppStore.getState().activeDocument as any).document.id).toBe('prior-asm');

    await cmd.apply();
    const { activeDocument } = useAppStore.getState();
    if (activeDocument?.kind !== 'assembly') throw new Error('guard');
    expect(activeDocument.document.components).toHaveLength(2);
  });
});
