import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AssemblyDocument, MaterialEntry, PanelFeature, PartDocument } from '@zilventor/shared';
import { useAppStore } from '../../store/useAppStore';
import { AddMaterialCommand } from '../AddMaterialCommand';
import { EditMaterialCommand } from '../EditMaterialCommand';
import { DeleteMaterialCommand } from '../DeleteMaterialCommand';

const emptyAssembly = (): AssemblyDocument => ({
  id: 'A', name: 'A', units: 'mm', parameters: {}, properties: {},
  components: [], constraints: [], groundedComponentPaths: [],
  colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
  materials: [],
  hardware: [],
});

const partWithPanel = (materialId: string, panelId = 'pf-1'): PartDocument => {
  const panel: PanelFeature = {
    kind: 'panel', id: panelId,
    length: { kind: 'literal', value: 600 },
    width: { kind: 'literal', value: 400 },
    thickness: { kind: 'literal', value: 18 },
    thicknessFromMaterial: true,
    materialId,
    grain: 'length',
    edgeBands: { front: null, back: null, left: null, right: null },
  };
  return {
    id: 'P1', name: 'P1', units: 'mm', parameters: {}, properties: {},
    featureTree: [panel],
    materials: [],
    hardware: [],
  };
};

const seedMat: MaterialEntry = {
  id: 'mat-seed', name: 'Birch 18', defaultThickness: 18, color: '#cfa84b',
};

describe('Material commands', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: emptyAssembly() });
  });

  it('Add appends a new material with a generated id', async () => {
    await new AddMaterialCommand({ name: 'Birch 18', defaultThickness: 18, color: '#d8c896' }).apply();
    const mats = useAppStore.getState().activeAssembly!.materials;
    expect(mats).toHaveLength(1);
    expect(mats[0]!.name).toBe('Birch 18');
    expect(mats[0]!.id).toMatch(/^mat-/);
  });

  it('Edit changes name/thickness/color', async () => {
    await new AddMaterialCommand({ name: 'Birch 18', defaultThickness: 18, color: '#cfa84b' }).apply();
    const id = useAppStore.getState().activeAssembly!.materials[0]!.id;
    await new EditMaterialCommand(id, { name: 'Oak 22', defaultThickness: 22, color: '#000000' }).apply();
    const mat = useAppStore.getState().activeAssembly!.materials[0]!;
    expect(mat.name).toBe('Oak 22');
    expect(mat.defaultThickness).toBe(22);
    expect(mat.color).toBe('#000000');
  });

  it('Add rejects duplicate name (case-insensitive)', async () => {
    await new AddMaterialCommand({ name: 'Birch 18', defaultThickness: 18, color: '#cfa84b' }).apply();
    await expect(
      new AddMaterialCommand({ name: 'birch 18', defaultThickness: 18, color: '#000000' }).apply()
    ).rejects.toThrow(/DUPLICATE_NAME/);
    expect(useAppStore.getState().activeAssembly!.materials).toHaveLength(1);
  });

  it('Delete succeeds when no references', async () => {
    await new AddMaterialCommand({ name: 'Birch 18', defaultThickness: 18, color: '#cfa84b' }).apply();
    const id = useAppStore.getState().activeAssembly!.materials[0]!.id;
    await new DeleteMaterialCommand(id).apply();
    expect(useAppStore.getState().activeAssembly!.materials).toHaveLength(0);
  });

  it('Delete rejects when referenced by a panel (MATERIAL_IN_USE)', async () => {
    // Switch active doc to a part containing a panel that references the material.
    useAppStore.getState().setActivePart(partWithPanel(seedMat.id));
    // Seed the part's material registry.
    useAppStore.getState().addMaterial(seedMat);
    await expect(new DeleteMaterialCommand(seedMat.id).apply()).rejects.toThrow(/MATERIAL_IN_USE/);
    // Material remains in registry.
    expect(useAppStore.getState().activePart!.materials).toHaveLength(1);
  });

  it('revert undoes Add', async () => {
    const cmd = new AddMaterialCommand({ name: 'Walnut 18', defaultThickness: 18, color: '#5a3a1a' });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly!.materials).toHaveLength(1);
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.materials).toHaveLength(0);
  });
});

describe('AddMaterialCommand — sheet stock fields', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: emptyAssembly() });
  });

  it('accepts sheetLengthMm + sheetWidthMm and stores them on the entry', async () => {
    await new AddMaterialCommand({
      name: 'Birch', defaultThickness: 18, color: '#aabbcc',
      sheetLengthMm: 2440, sheetWidthMm: 1220,
    }).apply();
    const entry = useAppStore.getState().activeAssembly!.materials.at(-1)!;
    expect(entry.sheetLengthMm).toBe(2440);
    expect(entry.sheetWidthMm).toBe(1220);
  });

  it('omits sheet-stock fields when not provided', async () => {
    await new AddMaterialCommand({ name: 'Plain', defaultThickness: 18, color: '#aabbcc' }).apply();
    const entry = useAppStore.getState().activeAssembly!.materials.at(-1)!;
    expect('sheetLengthMm' in entry).toBe(false);
    expect('sheetWidthMm' in entry).toBe(false);
  });
});

describe('EditMaterialCommand — sheet stock fields', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: emptyAssembly() });
  });

  it('round-trips sheet-stock patch through the registry', async () => {
    await new AddMaterialCommand({ name: 'X', defaultThickness: 18, color: '#aabbcc' }).apply();
    const entry = useAppStore.getState().activeAssembly!.materials.at(-1)!;
    await new EditMaterialCommand(entry.id, { sheetLengthMm: 3000, sheetWidthMm: 1500 }).apply();
    const updated = useAppStore.getState().activeAssembly!.materials.find((m) => m.id === entry.id)!;
    expect(updated.sheetLengthMm).toBe(3000);
    expect(updated.sheetWidthMm).toBe(1500);
  });

  it('clearSheetStock: true strips sheetLengthMm + sheetWidthMm atomically', async () => {
    await new AddMaterialCommand({ name: 'Y', defaultThickness: 18, color: '#aabbcc', sheetLengthMm: 2440, sheetWidthMm: 1220 }).apply();
    const entry = useAppStore.getState().activeAssembly!.materials.at(-1)!;
    expect(entry.sheetLengthMm).toBe(2440);
    const cmd = new EditMaterialCommand(entry.id, { name: 'Y', clearSheetStock: true });
    await cmd.apply();
    const after = useAppStore.getState().activeAssembly!.materials.find((m) => m.id === entry.id)!;
    expect('sheetLengthMm' in after).toBe(false);
    expect('sheetWidthMm' in after).toBe(false);
    // revert restores the original entry wholesale
    await cmd.revert();
    const reverted = useAppStore.getState().activeAssembly!.materials.find((m) => m.id === entry.id)!;
    expect(reverted.sheetLengthMm).toBe(2440);
    expect(reverted.sheetWidthMm).toBe(1220);
  });
});

describe('AddMaterialCommand — kernel sync', () => {
  let mockSetMaterials: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSetMaterials = vi.fn().mockResolvedValue(undefined);
    // Inject mock kernel into store. Partial mock — no setKernel action on store.
    useAppStore.setState({
      kernel: { setMaterials: mockSetMaterials } as never,
    } as never);
  });

  afterEach(() => {
    useAppStore.setState({ kernel: null } as never);
    vi.restoreAllMocks();
  });

  it('apply() calls kernel.setMaterials with the part id and updated materials (part active)', async () => {
    // Seed a part as active document.
    const part: PartDocument = {
      id: 'p-sync-1', name: 'P', units: 'mm', parameters: {}, properties: {},
      featureTree: [], materials: [], hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'part', document: part });

    const cmd = new AddMaterialCommand({ name: 'Walnut', defaultThickness: 18, color: '#5a3a1a' });
    await cmd.apply();

    const updatedPart = useAppStore.getState().activePart!;
    expect(mockSetMaterials).toHaveBeenCalledOnce();
    expect(mockSetMaterials).toHaveBeenCalledWith(updatedPart.id, updatedPart.materials);
    expect(updatedPart.materials).toHaveLength(1);
  });

  it('apply() does NOT call kernel.setMaterials when assembly is active', async () => {
    // Assembly active — activePart is null — syncPartMaterials no-ops.
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: emptyAssembly() });

    const cmd = new AddMaterialCommand({ name: 'Walnut', defaultThickness: 18, color: '#5a3a1a' });
    await cmd.apply();

    expect(mockSetMaterials).not.toHaveBeenCalled();
  });

  it('revert() calls kernel.setMaterials after removing the material (part active)', async () => {
    const part: PartDocument = {
      id: 'p-sync-2', name: 'P', units: 'mm', parameters: {}, properties: {},
      featureTree: [], materials: [], hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'part', document: part });

    const cmd = new AddMaterialCommand({ name: 'Cherry', defaultThickness: 15, color: '#8b1a1a' });
    await cmd.apply();
    mockSetMaterials.mockClear();

    await cmd.revert();
    const revertedPart = useAppStore.getState().activePart!;
    expect(mockSetMaterials).toHaveBeenCalledOnce();
    expect(mockSetMaterials).toHaveBeenCalledWith(revertedPart.id, revertedPart.materials);
    expect(revertedPart.materials).toHaveLength(0);
  });
});
