import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { PlaceComponentCommand } from '../PlaceComponentCommand';
import type { AssemblyDocument } from '@zilventor/shared';

describe('PlaceComponentCommand', () => {
  beforeEach(() => {
    const asm: AssemblyDocument = { id: 'A1', name: 'a', units: 'mm', parameters: {}, components: [], constraints: [], groundedComponentIds: [] };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
  });

  it('apply() adds a ComponentInstance to the active assembly', async () => {
    const cmd = new PlaceComponentCommand({ partPath: 'leg.zipt' });
    await cmd.apply();
    const s = useAppStore.getState();
    expect(s.activeAssembly?.components).toHaveLength(1);
    expect(s.activeAssembly?.components[0]!.partPath).toBe('leg.zipt');
  });

  it('revert() removes the placed component', async () => {
    const cmd = new PlaceComponentCommand({ partPath: 'leg.zipt' });
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly?.components).toHaveLength(0);
  });
});
