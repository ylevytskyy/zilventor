import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { DeleteComponentCommand } from '../DeleteComponentCommand';
import type { AssemblyDocument, ComponentInstance } from '@zilventor/shared';

describe('DeleteComponentCommand', () => {
  const c: ComponentInstance = {
    id: 'C1', partPath: 'leg.zipt',
    position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 },
    visible: true,
  };
  beforeEach(() => {
    const asm: AssemblyDocument = { id: 'A1', name: 'a', units: 'mm', parameters: {}, properties: {}, components: [{ ...c }], constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {}, materials: [] ,
    hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
  });

  it('apply() removes the component', async () => {
    const cmd = new DeleteComponentCommand({ id: 'C1' });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly?.components).toHaveLength(0);
  });

  it('revert() re-adds the component at the same position', async () => {
    const cmd = new DeleteComponentCommand({ id: 'C1' });
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly?.components).toHaveLength(1);
    expect(useAppStore.getState().activeAssembly?.components[0]).toEqual(c);
  });
});
