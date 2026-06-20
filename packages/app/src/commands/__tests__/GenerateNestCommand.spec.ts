import { describe, it, expect, beforeEach } from 'vitest';
import { GenerateNestCommand } from '../GenerateNestCommand';
import { useAppStore } from '../../store/useAppStore';
import type { CutListResult } from '@zilventor/shared/src/cutListRow';
import type { MaterialRegistry } from '@zilventor/shared/src/material';

const fakeResult = (rows: CutListResult['rows'] = []): CutListResult => ({
  rows, bandTotals: [], excluded: { componentCount: 0, partCount: 0 },
});

const matRegistry = (): MaterialRegistry => [
  { id: 'm1', name: 'Birch', defaultThickness: 18, color: '#aabbcc',
    sheetLengthMm: 2440, sheetWidthMm: 1220 },
];

function makeActiveAssembly() {
  return {
    id: 'A', name: 'A', units: 'mm' as const, parameters: {}, properties: {},
    components: [], constraints: [], groundedComponentPaths: [],
    colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
  };
}

describe('GenerateNestCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeAssembly: makeActiveAssembly() } as any);
  });

  it('apply writes asm.nest with sheets + fingerprint + generatedAt', async () => {
    const cmd = new GenerateNestCommand({
      kerfMm: 3,
      result: fakeResult([{
        rowKey: 'r1', itemNumber: 1, qty: 1, length: 600, width: 400, thickness: 18,
        materialId: 'm1', materialName: 'Birch', grain: 'length',
        edgeBands: { front: null, back: null, left: null, right: null },
        partPath: 'p.zipt', partName: 'P', componentPathKeys: ['c1'],
      }]),
      materials: matRegistry(),
    });
    await cmd.apply();
    const nest = useAppStore.getState().activeAssembly!.nest;
    expect(nest).toBeDefined();
    expect(nest!.params.kerfMm).toBe(3);
    expect(nest!.sheets).toHaveLength(1);
    expect(nest!.inputFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof nest!.generatedAt).toBe('number');
  });

  it('revert restores the prior asm.nest (undefined for first generation)', async () => {
    const cmd = new GenerateNestCommand({ kerfMm: 3, result: fakeResult([]), materials: matRegistry() });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly!.nest).toBeDefined();
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.nest).toBeUndefined();
  });

  it('revert restores the prior NestState for subsequent generations', async () => {
    const cmd1 = new GenerateNestCommand({ kerfMm: 3, result: fakeResult([]), materials: matRegistry() });
    await cmd1.apply();
    const firstNest = useAppStore.getState().activeAssembly!.nest;
    const cmd2 = new GenerateNestCommand({ kerfMm: 5, result: fakeResult([]), materials: matRegistry() });
    await cmd2.apply();
    expect(useAppStore.getState().activeAssembly!.nest!.params.kerfMm).toBe(5);
    await cmd2.revert();
    expect(useAppStore.getState().activeAssembly!.nest).toEqual(firstNest);
  });

  it('idempotent on same inputs (re-apply produces same fingerprint, sheets)', async () => {
    const opts = { kerfMm: 3, result: fakeResult([]), materials: matRegistry() };
    const a = new GenerateNestCommand(opts); await a.apply();
    const fp1 = useAppStore.getState().activeAssembly!.nest!.inputFingerprint;
    const sheets1 = useAppStore.getState().activeAssembly!.nest!.sheets;
    const b = new GenerateNestCommand(opts); await b.apply();
    const fp2 = useAppStore.getState().activeAssembly!.nest!.inputFingerprint;
    const sheets2 = useAppStore.getState().activeAssembly!.nest!.sheets;
    expect(fp1).toBe(fp2);
    expect(sheets1).toEqual(sheets2);
  });

  it('applies oversize to the packed footprint and persists it in nest.params', async () => {
    const cmd = new GenerateNestCommand({
      kerfMm: 3,
      oversize: { lengthMm: 10, widthMm: 6 },
      result: fakeResult([{
        rowKey: 'r1', itemNumber: 1, qty: 1, length: 600, width: 400, thickness: 18,
        materialId: 'm1', materialName: 'Birch', grain: 'length',
        edgeBands: { front: null, back: null, left: null, right: null },
        partPath: 'p.zipt', partName: 'P', componentPathKeys: ['c1'],
      }]),
      materials: matRegistry(),
    });
    await cmd.apply();
    const nest = useAppStore.getState().activeAssembly!.nest!;
    // Oversize persisted on params.
    expect(nest.params.oversize).toEqual({ lengthMm: 10, widthMm: 6 });
    // Packed panel is raw-sized (net + oversize): 610 × 406.
    expect(nest.sheets[0]!.panels[0]).toMatchObject({ length: 610, width: 406 });
  });

  it('different oversize yields a different fingerprint (staleness detection)', async () => {
    const result = fakeResult([{
      rowKey: 'r1', itemNumber: 1, qty: 1, length: 600, width: 400, thickness: 18,
      materialId: 'm1', materialName: 'Birch', grain: 'length',
      edgeBands: { front: null, back: null, left: null, right: null },
      partPath: 'p.zipt', partName: 'P', componentPathKeys: ['c1'],
    }]);
    const a = new GenerateNestCommand({ kerfMm: 3, oversize: { lengthMm: 0, widthMm: 0 }, result, materials: matRegistry() });
    await a.apply();
    const fp0 = useAppStore.getState().activeAssembly!.nest!.inputFingerprint;
    const b = new GenerateNestCommand({ kerfMm: 3, oversize: { lengthMm: 10, widthMm: 0 }, result, materials: matRegistry() });
    await b.apply();
    const fp1 = useAppStore.getState().activeAssembly!.nest!.inputFingerprint;
    expect(fp0).not.toBe(fp1);
  });

  it('apply with no active assembly is a no-op (does not throw)', async () => {
    useAppStore.setState({ activeAssembly: null } as never);
    const cmd = new GenerateNestCommand({ kerfMm: 3, result: fakeResult([]), materials: matRegistry() });
    await expect(cmd.apply()).resolves.toBeUndefined();
    expect(useAppStore.getState().activeAssembly).toBeNull();
  });
});
