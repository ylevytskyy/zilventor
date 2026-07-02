import { describe, expect, it, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { SetUnitPriceCommand } from '../SetUnitPriceCommand';
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

describe('SetUnitPriceCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: null, activeAssembly: null });
  });

  it('apply() writes the price under the given key', async () => {
    seedAssembly(makeAsm());
    await new SetUnitPriceCommand({ key: 'hardware:hinge-35mm-cup-full', price: 1.5 }).apply();
    expect(useAppStore.getState().activeAssembly!.unitPrices).toEqual({ 'hardware:hinge-35mm-cup-full': 1.5 });
  });

  it('revert() restores whole-map ABSENCE when unitPrices was absent before apply()', async () => {
    seedAssembly(makeAsm());
    expect(useAppStore.getState().activeAssembly!.unitPrices).toBeUndefined();
    const cmd = new SetUnitPriceCommand({ key: 'material:m-birch', price: 12 });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly!.unitPrices).toEqual({ 'material:m-birch': 12 });
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.unitPrices).toBeUndefined();
    expect('unitPrices' in useAppStore.getState().activeAssembly!).toBe(false);
  });

  it('revert() restores per-key ABSENCE when the map existed but the key was new', async () => {
    seedAssembly(makeAsm({ unitPrices: { 'edgeband:m-pvc': 0.2 } }));
    const cmd = new SetUnitPriceCommand({ key: 'linear:m-rod', price: 3.3 });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly!.unitPrices).toEqual({ 'edgeband:m-pvc': 0.2, 'linear:m-rod': 3.3 });
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.unitPrices).toEqual({ 'edgeband:m-pvc': 0.2 });
  });

  it('revert() restores the prior value when the key already had a price', async () => {
    seedAssembly(makeAsm({ unitPrices: { 'connector:confirmat': 0.05 } }));
    const cmd = new SetUnitPriceCommand({ key: 'connector:confirmat', price: 0.09 });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly!.unitPrices).toEqual({ 'connector:confirmat': 0.09 });
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.unitPrices).toEqual({ 'connector:confirmat': 0.05 });
  });
});
