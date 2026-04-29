import { describe, it, expect, beforeEach } from 'vitest';
import { ToggleGroundedCommand } from '../ToggleGroundedCommand';
import { useAppStore } from '../../store/useAppStore';

beforeEach(() => {
  useAppStore.setState({
    activeAssembly: {
      id: 'A', name: 'a', units: 'mm', parameters: {}, components: [], constraints: [],
      groundedComponentPaths: [],
    } as any,
    activeDocument: { kind: 'assembly', document: {} as any },
  });
});

describe('ToggleGroundedCommand', () => {
  it('apply adds componentId to groundedComponentPaths', async () => {
    const cmd = new ToggleGroundedCommand({ componentId: 'C1' });
    await cmd.apply();
    const paths = useAppStore.getState().activeAssembly!.groundedComponentPaths;
    expect(paths.some((p) => p.length === 1 && p[0] === 'C1')).toBe(true);
  });
  it('revert removes componentId from groundedComponentPaths', async () => {
    const cmd = new ToggleGroundedCommand({ componentId: 'C1' });
    await cmd.apply();
    await cmd.revert();
    const paths = useAppStore.getState().activeAssembly!.groundedComponentPaths;
    expect(paths.some((p) => p.length === 1 && p[0] === 'C1')).toBe(false);
  });
});
