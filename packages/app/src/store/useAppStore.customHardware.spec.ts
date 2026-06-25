import { describe, it, expect, beforeEach } from 'vitest';
import type { AssemblyDocument, PartDocument } from '@zilventor/shared';
import type { HardwareCatalogEntry } from '@zilventor/shared/src/hardware/resolveCatalog';
import { useAppStore } from './useAppStore';

const entry: HardwareCatalogEntry = {
  id: 'acme-pull-128',
  name: 'ACME Bar Pull 128mm',
  category: 'drawerHandles',
  vendor: 'ACME',
  notes: '',
  bboxMm: { l: 140, w: 12, h: 30 },
  attachPoints: [{ name: 'screw-a', position: { x: 6, y: 0, z: 0 } }],
};

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

function makePart(): PartDocument {
  return {
    id: 'part-1',
    name: 'Test Part',
    units: 'mm',
    parameters: {},
    featureTree: [],
    properties: {},
    materials: [],
    hardware: [],
  };
}

describe('addCustomHardware', () => {
  beforeEach(() => {
    useAppStore.setState({ activePart: null, activeAssembly: null } as never);
  });

  it('appends entries to activeAssembly.customHardware', () => {
    const asm = makeAssembly();
    useAppStore.setState({
      activeAssembly: asm,
      activeDocument: { kind: 'assembly', document: asm },
    } as never);

    useAppStore.getState().addCustomHardware([entry]);

    expect(useAppStore.getState().activeAssembly?.customHardware).toEqual([entry]);
    expect(useAppStore.getState().activeDocument).toMatchObject({ kind: 'assembly' });
  });

  it('is additive across calls', () => {
    const asm = makeAssembly();
    useAppStore.setState({
      activeAssembly: asm,
      activeDocument: { kind: 'assembly', document: asm },
    } as never);

    useAppStore.getState().addCustomHardware([entry]);
    useAppStore.getState().addCustomHardware([{ ...entry, id: 'acme-pull-160' }]);

    expect(
      useAppStore.getState().activeAssembly?.customHardware?.map((e) => e.id),
    ).toEqual(['acme-pull-128', 'acme-pull-160']);
  });

  it('falls back to activePart when no active assembly', () => {
    const part = makePart();
    useAppStore.setState({
      activePart: part,
      activeAssembly: null,
      activeDocument: { kind: 'part', document: part },
    } as never);

    useAppStore.getState().addCustomHardware([entry]);

    expect(useAppStore.getState().activePart?.customHardware).toEqual([entry]);
    expect(useAppStore.getState().activeDocument).toMatchObject({ kind: 'part' });
  });
});
