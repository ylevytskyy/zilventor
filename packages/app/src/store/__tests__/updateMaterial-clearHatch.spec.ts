// packages/app/src/store/__tests__/updateMaterial-clearHatch.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../useAppStore';

function seedPart(mat: Record<string, unknown>): void {
  const part = {
    id: 'p', name: 'P', units: 'mm' as const, parameters: {}, properties: {},
    featureTree: [], materials: [mat], hardware: [],
  };
  useAppStore.setState({
    activePart: part,
    activeAssembly: null,
    activeDocument: { kind: 'part', document: part },
  } as never);
}

describe('useAppStore.updateMaterial — clearHatch', () => {
  beforeEach(() => {
    seedPart({
      id: 'm1', name: 'Wood', defaultThickness: 18, color: '#aabbcc',
      hatchAngleDeg: 30, hatchSpacingMm: 2,
    });
  });

  it('strips both hatch keys when clearHatch: true', () => {
    useAppStore.getState().updateMaterial('m1', { clearHatch: true });
    const m = useAppStore.getState().activePart!.materials[0]!;
    expect('hatchAngleDeg' in m).toBe(false);
    expect('hatchSpacingMm' in m).toBe(false);
    expect(m.name).toBe('Wood');
    expect(m.defaultThickness).toBe(18);
    expect(m.color).toBe('#aabbcc');
  });

  it('clearHatch atomically combines with other patch fields', () => {
    useAppStore.getState().updateMaterial('m1', { name: 'Oak', clearHatch: true });
    const m = useAppStore.getState().activePart!.materials[0]!;
    expect(m.name).toBe('Oak');
    expect('hatchAngleDeg' in m).toBe(false);
    expect('hatchSpacingMm' in m).toBe(false);
  });

  it('setting hatch then clearing round-trips', () => {
    seedPart({ id: 'm1', name: 'Wood', defaultThickness: 18, color: '#aabbcc' });
    useAppStore.getState().updateMaterial('m1', { hatchAngleDeg: 60, hatchSpacingMm: 4 });
    let m = useAppStore.getState().activePart!.materials[0]!;
    expect(m.hatchAngleDeg).toBe(60);
    expect(m.hatchSpacingMm).toBe(4);

    useAppStore.getState().updateMaterial('m1', { clearHatch: true });
    m = useAppStore.getState().activePart!.materials[0]!;
    expect('hatchAngleDeg' in m).toBe(false);
    expect('hatchSpacingMm' in m).toBe(false);
  });

  it('clearHatch on an assembly material also strips both keys', () => {
    const asm = {
      id: 'a', name: 'A', units: 'mm' as const, parameters: {},
      components: [], constraints: [],
      groundedComponentPaths: [], bomItemNumbers: {}, cutListItemNumbers: {},
      colorOverrides: {}, colors: {}, properties: {},
      materials: [{
        id: 'm2', name: 'Steel', defaultThickness: 3, color: '#999999',
        hatchAngleDeg: 20, hatchSpacingMm: 1,
      }],
      hardware: [],
    };
    useAppStore.setState({
      activePart: null,
      activeAssembly: asm,
      activeDocument: { kind: 'assembly', document: asm },
    } as never);

    useAppStore.getState().updateMaterial('m2', { clearHatch: true });
    const m = useAppStore.getState().activeAssembly!.materials[0]!;
    expect('hatchAngleDeg' in m).toBe(false);
    expect('hatchSpacingMm' in m).toBe(false);
  });
});
