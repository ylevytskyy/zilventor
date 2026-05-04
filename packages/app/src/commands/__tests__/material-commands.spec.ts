import { describe, it, expect, beforeEach } from 'vitest';
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
