import { describe, it, expect, beforeEach } from 'vitest';
import { ToggleGroundedCommand } from '../ToggleGroundedCommand';
import { useAppStore } from '../../store/useAppStore';

beforeEach(() => {
  useAppStore.setState({
    activeAssembly: {
      id: 'A', name: 'a', units: 'mm', parameters: {}, components: [], constraints: [],
      groundedComponentIds: [],
    } as any,
    activeDocument: { kind: 'assembly', document: {} as any },
  });
});

describe('ToggleGroundedCommand', () => {
  it('apply adds componentId to groundedComponentIds', async () => {
    const cmd = new ToggleGroundedCommand({ componentId: 'C1' });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly!.groundedComponentIds).toContain('C1');
  });
  it('revert removes componentId from groundedComponentIds', async () => {
    const cmd = new ToggleGroundedCommand({ componentId: 'C1' });
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.groundedComponentIds).not.toContain('C1');
  });
});
