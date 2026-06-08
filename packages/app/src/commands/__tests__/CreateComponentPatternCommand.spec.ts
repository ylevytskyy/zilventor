// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { CreateComponentPatternCommand } from '../CreateComponentPatternCommand';
import type { AssemblyDocument, ComponentInstance } from '@zilventor/shared';

function makeAsm(components: AssemblyDocument['components'] = []): AssemblyDocument {
  return {
    id: 'asm1', name: 'test-asm', units: 'mm', parameters: {}, properties: {},
    components, constraints: [], groundedComponentPaths: [], colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
  };
}

const srcInstance: ComponentInstance = {
  id: 'src-1',
  partPath: 'panel.zipt',
  position: { x: 0, y: 0, z: 0 },
  rotation: { rx: 0, ry: 0, rz: 0 },
  visible: true,
  pose: { translation: { x: 5, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
};

describe('CreateComponentPatternCommand', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeAsm([srcInstance]) });
  });

  it('apply() adds count1-1 instances for 1D pattern', async () => {
    const cmd = new CreateComponentPatternCommand({
      sourceInstanceId: 'src-1',
      dir1: 'x', count1: 3, spacing1: 10,
    });
    await cmd.apply();
    const comps = useAppStore.getState().activeAssembly!.components;
    // source (1) + 2 new = 3 total
    expect(comps).toHaveLength(3);
  });

  it('apply() places instances at correct translated positions', async () => {
    const cmd = new CreateComponentPatternCommand({
      sourceInstanceId: 'src-1',
      dir1: 'x', count1: 3, spacing1: 10,
    });
    await cmd.apply();
    const comps = useAppStore.getState().activeAssembly!.components;
    // src is at x=5; new ones at x=15, x=25
    const newComps = comps.filter((c) => c.id !== 'src-1');
    expect(newComps).toHaveLength(2);
    const xs = newComps.map((c) => c.pose!.translation.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(15, 6);
    expect(xs[1]).toBeCloseTo(25, 6);
  });

  it('apply() 2D grid: count1=2,count2=2 → 3 new instances', async () => {
    const cmd = new CreateComponentPatternCommand({
      sourceInstanceId: 'src-1',
      dir1: 'x', count1: 2, spacing1: 10,
      dir2: 'y', count2: 2, spacing2: 8,
    });
    await cmd.apply();
    const comps = useAppStore.getState().activeAssembly!.components;
    expect(comps).toHaveLength(4); // src + 3
  });

  it('revert() removes all added instances', async () => {
    const cmd = new CreateComponentPatternCommand({
      sourceInstanceId: 'src-1',
      dir1: 'x', count1: 3, spacing1: 10,
    });
    await cmd.apply();
    await cmd.revert();
    const comps = useAppStore.getState().activeAssembly!.components;
    expect(comps).toHaveLength(1); // only src remains
  });

  it('apply() noops if sourceInstanceId not found', async () => {
    const cmd = new CreateComponentPatternCommand({
      sourceInstanceId: 'no-such', dir1: 'x', count1: 3, spacing1: 10,
    });
    await cmd.apply();
    const comps = useAppStore.getState().activeAssembly!.components;
    expect(comps).toHaveLength(1);
  });
});
