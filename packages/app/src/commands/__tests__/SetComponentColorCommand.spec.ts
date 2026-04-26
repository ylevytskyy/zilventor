import { describe, it, expect } from 'vitest';
import { SetComponentColorCommand } from '../SetComponentColorCommand';
import { useAppStore } from '../../store/useAppStore';

describe('SetComponentColorCommand', () => {
  it('mutates component color via setComponentColor', async () => {
    useAppStore.setState({
      activeAssembly: {
        id: 'A', name: 'A', units: 'mm', parameters: {},
        components: [{ id: 'C1', partPath: 'p', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true }],
        constraints: [], groundedComponentIds: ['C1'],
        colors: {}, bomItemNumbers: {},
      },
    } as any);
    await new SetComponentColorCommand({ id: 'C1', color: { kind: 'hex', hex: '#abc123' } }).apply();
    expect(useAppStore.getState().activeAssembly!.components[0]!.color).toEqual({ kind: 'hex', hex: '#abc123' });
  });
});
