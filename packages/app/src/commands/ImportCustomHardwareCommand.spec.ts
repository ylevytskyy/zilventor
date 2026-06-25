import { describe, it, expect, beforeEach } from 'vitest';
import type { AssemblyDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { ImportCustomHardwareCommand } from './ImportCustomHardwareCommand';

const a = {
  id: 'a',
  name: 'A',
  category: 'drawerHandles' as const,
  vendor: '',
  notes: '',
  bboxMm: { l: 10, w: 10, h: 10 },
  attachPoints: [],
};
const b = { ...a, id: 'b', name: 'B' };

function makeAssembly(): AssemblyDocument {
  return {
    id: 'asm-1',
    name: 'Test Assembly',
    units: 'mm',
    parameters: {},
    components: [],
    constraints: [],
    groundedComponentPaths: [],
    colors: {},
    bomItemNumbers: {},
    cutListItemNumbers: {},
    colorOverrides: {},
    properties: {},
    materials: [],
    hardware: [],
  };
}

describe('ImportCustomHardwareCommand', () => {
  beforeEach(() => {
    const asm = makeAssembly();
    useAppStore.setState({
      activePart: null,
      activeAssembly: asm,
      activeDocument: { kind: 'assembly', document: asm },
    } as never);
  });

  it('apply adds the imported ids; revert removes exactly them', async () => {
    const cmd = new ImportCustomHardwareCommand({ entries: [a, b] });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly?.customHardware?.map((e) => e.id)).toEqual(['a', 'b']);
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly?.customHardware ?? []).toEqual([]);
  });

  it('apply -> revert -> apply (redo) restores exactly the same ids without duplication', async () => {
    const cmd = new ImportCustomHardwareCommand({ entries: [a, b] });
    await cmd.apply();
    await cmd.revert();
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly?.customHardware?.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('revert only removes ids it imported, leaving pre-existing custom entries intact', async () => {
    useAppStore.getState().addCustomHardware([{ ...a, id: 'pre' }]);
    const cmd = new ImportCustomHardwareCommand({ entries: [a, b] });
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly?.customHardware?.map((e) => e.id)).toEqual(['pre']);
  });
});
