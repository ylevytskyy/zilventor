// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { ToggleSubAssemblyFlexibleCommand } from '../ToggleSubAssemblyFlexibleCommand';
import type { AssemblyDocument, ComponentInstance } from '@zilventor/shared';

function makeDoc(components: ComponentInstance[]): AssemblyDocument {
  return {
    id: 'A', name: 'A', units: 'mm', parameters: {},
    components, constraints: [], groundedComponentPaths: [],
    colors: {}, bomItemNumbers: {}, colorOverrides: {},
  };
}

describe('ToggleSubAssemblyFlexibleCommand', () => {
  beforeEach(() => {
    const sub: ComponentInstance = { id: 's', partPath: 'sub.ziasm',
      position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeDoc([sub]) });
    useAppStore.getState().setSolverDirty(false);
  });

  it('apply() flips the flexible flag and bumps solverDirty', async () => {
    await new ToggleSubAssemblyFlexibleCommand({ componentId: 's' }).apply();
    const s = useAppStore.getState();
    expect(s.activeAssembly?.components.find((c) => c.id === 's')?.flexible).toBe(true);
    expect(s.solverDirty).toBe(true);
  });

  it('apply() flips a true flag back to false', async () => {
    const sub: ComponentInstance = { id: 's', partPath: 'sub.ziasm', flexible: true,
      position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeDoc([sub]) });
    await new ToggleSubAssemblyFlexibleCommand({ componentId: 's' }).apply();
    expect(useAppStore.getState().activeAssembly?.components.find((c) => c.id === 's')?.flexible).toBe(false);
  });

  it('revert() restores the previous flag', async () => {
    const cmd = new ToggleSubAssemblyFlexibleCommand({ componentId: 's' });
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly?.components.find((c) => c.id === 's')?.flexible).toBeFalsy();
  });

  it('apply() is a no-op when component id is unknown', async () => {
    await new ToggleSubAssemblyFlexibleCommand({ componentId: 'missing' }).apply();
    expect(useAppStore.getState().activeAssembly?.components.find((c) => c.id === 's')?.flexible).toBeFalsy();
  });
});
