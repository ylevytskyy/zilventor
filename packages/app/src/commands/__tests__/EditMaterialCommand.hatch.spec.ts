// packages/app/src/commands/__tests__/EditMaterialCommand.hatch.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { EditMaterialCommand } from '../EditMaterialCommand';

function seedPartWithBareMaterial(): void {
  const part = {
    id: 'p', name: 'P', units: 'mm' as const, parameters: {}, properties: {},
    featureTree: [],
    materials: [{ id: 'm1', name: 'Wood', defaultThickness: 18, color: '#aabbcc' }],
    hardware: [],
  };
  useAppStore.setState({
    activePart: part,
    activeAssembly: null,
    activeDocument: { kind: 'part', document: part },
  } as never);
}

describe('EditMaterialCommand — hatch revert correctness', () => {
  beforeEach(() => {
    seedPartWithBareMaterial();
  });

  it('revert removes hatch keys when prev had no hatch (apply added them)', async () => {
    const cmd = new EditMaterialCommand('m1', {
      name: 'Wood', defaultThickness: 18, color: '#aabbcc',
      hatchAngleDeg: 20, hatchSpacingMm: 2,
    });
    await cmd.apply();
    let m = useAppStore.getState().activePart!.materials[0]!;
    expect(m.hatchAngleDeg).toBe(20);
    expect(m.hatchSpacingMm).toBe(2);

    await cmd.revert();
    m = useAppStore.getState().activePart!.materials[0]!;
    expect('hatchAngleDeg' in m).toBe(false);
    expect('hatchSpacingMm' in m).toBe(false);
  });

  it('revert restores hatch values when prev had hatch', async () => {
    useAppStore.getState().updateMaterial('m1', { hatchAngleDeg: 30, hatchSpacingMm: 1.5 });

    const cmd = new EditMaterialCommand('m1', {
      name: 'Wood', defaultThickness: 18, color: '#aabbcc',
      hatchAngleDeg: 60, hatchSpacingMm: 4,
    });
    await cmd.apply();
    let m = useAppStore.getState().activePart!.materials[0]!;
    expect(m.hatchAngleDeg).toBe(60);
    expect(m.hatchSpacingMm).toBe(4);

    await cmd.revert();
    m = useAppStore.getState().activePart!.materials[0]!;
    expect(m.hatchAngleDeg).toBe(30);
    expect(m.hatchSpacingMm).toBe(1.5);
  });

  it('apply with clearHatch then revert restores previous hatch', async () => {
    useAppStore.getState().updateMaterial('m1', { hatchAngleDeg: 30, hatchSpacingMm: 1.5 });

    const cmd = new EditMaterialCommand('m1', { clearHatch: true });
    await cmd.apply();
    let m = useAppStore.getState().activePart!.materials[0]!;
    expect('hatchAngleDeg' in m).toBe(false);
    expect('hatchSpacingMm' in m).toBe(false);

    await cmd.revert();
    m = useAppStore.getState().activePart!.materials[0]!;
    expect(m.hatchAngleDeg).toBe(30);
    expect(m.hatchSpacingMm).toBe(1.5);
  });
});
