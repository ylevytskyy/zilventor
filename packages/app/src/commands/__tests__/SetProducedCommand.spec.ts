import { describe, expect, it, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { SetProducedCommand } from '../SetProducedCommand';
import type { AssemblyDocument } from '@zilventor/shared';

function makeAsm(overrides: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return {
    id: 'A', name: 'demo', units: 'mm', parameters: {}, properties: {},
    components: [], constraints: [], groundedComponentPaths: [], colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
    ...overrides,
  };
}

function seedAssembly(doc: AssemblyDocument): void {
  useAppStore.setState({
    activeDocument: { kind: 'assembly', document: doc },
    activeAssembly: doc,
  });
}

describe('SetProducedCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: null, activeAssembly: null });
  });

  it('apply() writes the produced flag under the given key', async () => {
    seedAssembly(makeAsm());
    await new SetProducedCommand({ key: '1#2', produced: true }).apply();
    expect(useAppStore.getState().activeAssembly!.producedPanels).toEqual({ '1#2': true });
  });

  it('revert() restores whole-map ABSENCE when producedPanels was absent before apply()', async () => {
    seedAssembly(makeAsm());
    expect(useAppStore.getState().activeAssembly!.producedPanels).toBeUndefined();
    const cmd = new SetProducedCommand({ key: '3#0', produced: true });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly!.producedPanels).toEqual({ '3#0': true });
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.producedPanels).toBeUndefined();
    expect('producedPanels' in useAppStore.getState().activeAssembly!).toBe(false);
  });

  it('revert() restores per-key ABSENCE when the map existed but the key was new', async () => {
    seedAssembly(makeAsm({ producedPanels: { '2#1': true } }));
    const cmd = new SetProducedCommand({ key: '5#0', produced: true });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly!.producedPanels).toEqual({ '2#1': true, '5#0': true });
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.producedPanels).toEqual({ '2#1': true });
  });

  it('revert() restores the prior value when the key already had a produced flag', async () => {
    seedAssembly(makeAsm({ producedPanels: { '4#2': false } }));
    const cmd = new SetProducedCommand({ key: '4#2', produced: true });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly!.producedPanels).toEqual({ '4#2': true });
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.producedPanels).toEqual({ '4#2': false });
  });

  it('setting produced:false on an existing true entry works and reverts', async () => {
    seedAssembly(makeAsm({ producedPanels: { '7#1': true } }));
    const cmd = new SetProducedCommand({ key: '7#1', produced: false });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly!.producedPanels).toEqual({ '7#1': false });
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.producedPanels).toEqual({ '7#1': true });
  });
});
