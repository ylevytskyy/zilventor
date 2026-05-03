// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { SetComponentColorOverrideCommand } from '../SetComponentColorOverrideCommand';
import { pathKey } from '@zilventor/shared';
import type { AssemblyDocument } from '@zilventor/shared';

function makeDoc(): AssemblyDocument {
  return {
    id: 'A', name: 'A', units: 'mm', parameters: {}, properties: {},
    components: [], constraints: [], groundedComponentPaths: [],
    colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [],
  };
}

describe('SetComponentColorOverrideCommand', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeDoc() });
  });

  it('apply() writes the override into activeAssembly.colorOverrides', async () => {
    const path = ['c1', 'leaf'];
    await new SetComponentColorOverrideCommand({
      path,
      color: { kind: 'palette', name: 'oak' },
    }).apply();
    const map = useAppStore.getState().activeAssembly!.colorOverrides;
    expect(map[pathKey(path)]).toEqual({ kind: 'palette', name: 'oak' });
  });

  it('apply(null) deletes an existing override', async () => {
    const path = ['c1', 'leaf'];
    useAppStore.getState().setActiveDocument({
      kind: 'assembly',
      document: { ...makeDoc(), colorOverrides: { [pathKey(path)]: { kind: 'hex', hex: '#abcdef' } } },
    });
    await new SetComponentColorOverrideCommand({ path, color: null }).apply();
    const map = useAppStore.getState().activeAssembly!.colorOverrides;
    expect(map[pathKey(path)]).toBeUndefined();
  });

  it('revert() restores the previous override after a write', async () => {
    const path = ['c1'];
    useAppStore.getState().setActiveDocument({
      kind: 'assembly',
      document: { ...makeDoc(), colorOverrides: { [pathKey(path)]: { kind: 'hex', hex: '#000000' } } },
    });
    const cmd = new SetComponentColorOverrideCommand({
      path,
      color: { kind: 'hex', hex: '#ffffff' },
    });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly!.colorOverrides[pathKey(path)]).toEqual({ kind: 'hex', hex: '#ffffff' });
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.colorOverrides[pathKey(path)]).toEqual({ kind: 'hex', hex: '#000000' });
  });

  it('revert() deletes the entry when there was no previous override', async () => {
    const path = ['c2'];
    const cmd = new SetComponentColorOverrideCommand({
      path,
      color: { kind: 'hex', hex: '#ffffff' },
    });
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.colorOverrides[pathKey(path)]).toBeUndefined();
  });
});
