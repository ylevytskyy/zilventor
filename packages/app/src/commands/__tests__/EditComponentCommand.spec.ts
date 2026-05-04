import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { EditComponentCommand } from '../EditComponentCommand';
import type { AssemblyDocument, ComponentInstance } from '@zilventor/shared';

describe('EditComponentCommand', () => {
  const original: ComponentInstance = {
    id: 'C1', partPath: 'leg.zipt',
    position: { x: 0, y: 0, z: 0 },
    rotation: { rx: 0, ry: 0, rz: 0 },
    visible: true,
  };

  beforeEach(() => {
    const asm: AssemblyDocument = {
      id: 'A1', name: 'a', units: 'mm', parameters: {}, properties: {},
      components: [{ ...original }],
      constraints: [],
      groundedComponentPaths: [],
      colors: {},
      bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [],
      hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
  });

  it('apply() updates position and rotation', async () => {
    const cmd = new EditComponentCommand({
      id: 'C1',
      patch: { position: { x: 50, y: 0, z: 0 } },
    });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly?.components[0]!.position.x).toBe(50);
  });

  it('revert() restores original values', async () => {
    const cmd = new EditComponentCommand({
      id: 'C1',
      patch: { position: { x: 50, y: 0, z: 0 } },
    });
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly?.components[0]!.position.x).toBe(0);
  });
});
