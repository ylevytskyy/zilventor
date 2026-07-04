import { describe, it, expect } from 'vitest';
import { SetComponentColorCommand } from '../SetComponentColorCommand';
import { useAppStore } from '../../store/useAppStore';
import type { AssemblyDocument, ComponentInstance } from '@zilventor/shared';

function makeAsm(components: ComponentInstance[]): AssemblyDocument {
  return {
    id: 'A', name: 'A', units: 'mm', parameters: {}, properties: {},
    components,
    constraints: [], groundedComponentPaths: [],
    colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
  };
}

describe('SetComponentColorCommand', () => {
  it('has a stable command name', () => {
    expect(new SetComponentColorCommand({ componentIds: ['C1'], color: undefined }).name).toBe('SetComponentColor');
  });

  it('mutates component color via setComponentColor', async () => {
    useAppStore.setState({ activeAssembly: makeAsm([
      { id: 'C1', partPath: 'p', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ]) } as any);
    await new SetComponentColorCommand({ componentIds: ['C1'], color: { kind: 'hex', hex: '#abc123' } }).apply();
    expect(useAppStore.getState().activeAssembly!.components[0]!.color).toEqual({ kind: 'hex', hex: '#abc123' });
  });

  it('revert() restores absence when the component had no color before apply()', async () => {
    useAppStore.setState({ activeAssembly: makeAsm([
      { id: 'C1', partPath: 'p', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ]) } as any);
    const cmd = new SetComponentColorCommand({ componentIds: ['C1'], color: { kind: 'hex', hex: '#abc123' } });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly!.components[0]!.color).toBeDefined();
    await cmd.revert();
    const c = useAppStore.getState().activeAssembly!.components[0]!;
    expect(c.color).toBeUndefined();
    expect('color' in c).toBe(false);
  });

  it('revert() restores the prior color when the component already had one', async () => {
    useAppStore.setState({ activeAssembly: makeAsm([
      { id: 'C1', partPath: 'p', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, color: { kind: 'hex', hex: '#000000' } },
    ]) } as any);
    const cmd = new SetComponentColorCommand({ componentIds: ['C1'], color: { kind: 'hex', hex: '#ffffff' } });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly!.components[0]!.color).toEqual({ kind: 'hex', hex: '#ffffff' });
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.components[0]!.color).toEqual({ kind: 'hex', hex: '#000000' });
  });

  it('multi-id: sets color on every componentId and revert() restores each independently', async () => {
    useAppStore.setState({ activeAssembly: makeAsm([
      { id: 'C1', partPath: 'p', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, color: { kind: 'hex', hex: '#111111' } },
      { id: 'C2', partPath: 'p', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ]) } as any);
    const cmd = new SetComponentColorCommand({ componentIds: ['C1', 'C2'], color: { kind: 'hex', hex: '#ffffff' } });
    await cmd.apply();
    const afterApply = useAppStore.getState().activeAssembly!.components;
    expect(afterApply[0]!.color).toEqual({ kind: 'hex', hex: '#ffffff' });
    expect(afterApply[1]!.color).toEqual({ kind: 'hex', hex: '#ffffff' });
    await cmd.revert();
    const afterRevert = useAppStore.getState().activeAssembly!.components;
    expect(afterRevert[0]!.color).toEqual({ kind: 'hex', hex: '#111111' });
    expect(afterRevert[1]!.color).toBeUndefined();
    expect('color' in afterRevert[1]!).toBe(false);
  });
});
