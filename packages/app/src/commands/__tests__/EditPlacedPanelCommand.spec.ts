import { describe, it, expect, beforeEach } from 'vitest';
import { EditPlacedPanelCommand, EditRejectedError } from '../EditPlacedPanelCommand';
import { useAppStore } from '../../store/useAppStore';
import type { NestState } from '@zilventor/shared';

function makeActiveAssembly(nest: NestState) {
  return {
    id: 'A', name: 'A', units: 'mm' as const, parameters: {}, properties: {},
    components: [], constraints: [], groundedComponentPaths: [],
    colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [], nest,
  };
}

const baseNest = (): NestState => ({
  params: { kerfMm: 3 },
  generatedAt: 1000,
  inputFingerprint: 'fp1',
  sheets: [
    {
      materialId: 'm1', sheetIndex: 1, sheetLengthMm: 2440, sheetWidthMm: 1220,
      utilizationPct: 50,
      panels: [
        { itemNumber: 1, rowKey: 'r1', instanceIndex: 1, x: 0, y: 0, length: 600, width: 400, rotated: false, grain: 'none' },
        { itemNumber: 2, rowKey: 'r2', instanceIndex: 1, x: 700, y: 0, length: 300, width: 200, rotated: false, grain: 'none' },
      ],
    },
  ],
  excluded: [],
});

function seed(nest: NestState): void {
  useAppStore.setState({ activeAssembly: makeActiveAssembly(nest) } as never);
}

describe('EditPlacedPanelCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeAssembly: null } as never);
  });

  it('move applies dx/dy and sets manuallyEdited', async () => {
    seed(baseNest());
    const cmd = new EditPlacedPanelCommand({
      materialId: 'm1', sheetIndex: 1, panelArrayIndex: 0,
      edit: { type: 'move', dx: 10, dy: 5 },
    });
    await cmd.apply();
    const sheet = useAppStore.getState().activeAssembly!.nest!.sheets[0]!;
    expect(sheet.panels[0]).toMatchObject({ x: 10, y: 5 });
    expect(sheet.manuallyEdited).toBe(true);
  });

  it('move is undoable — revert restores exact prior sheet', async () => {
    const nest = baseNest();
    seed(nest);
    const cmd = new EditPlacedPanelCommand({
      materialId: 'm1', sheetIndex: 1, panelArrayIndex: 0,
      edit: { type: 'move', dx: 10, dy: 5 },
    });
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.nest).toEqual(nest);
  });

  it('rotate toggles rotated and swaps length/width', async () => {
    seed(baseNest());
    const cmd = new EditPlacedPanelCommand({
      materialId: 'm1', sheetIndex: 1, panelArrayIndex: 0,
      edit: { type: 'rotate' },
    });
    await cmd.apply();
    const panel = useAppStore.getState().activeAssembly!.nest!.sheets[0]!.panels[0]!;
    expect(panel).toMatchObject({ rotated: true, length: 400, width: 600 });
  });

  it('rotate is undoable', async () => {
    const nest = baseNest();
    seed(nest);
    const cmd = new EditPlacedPanelCommand({
      materialId: 'm1', sheetIndex: 1, panelArrayIndex: 0,
      edit: { type: 'rotate' },
    });
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.nest).toEqual(nest);
  });

  it('flip toggles mirrored from absent to true', async () => {
    seed(baseNest());
    const cmd = new EditPlacedPanelCommand({
      materialId: 'm1', sheetIndex: 1, panelArrayIndex: 0,
      edit: { type: 'flip' },
    });
    await cmd.apply();
    const panel = useAppStore.getState().activeAssembly!.nest!.sheets[0]!.panels[0]!;
    expect(panel.mirrored).toBe(true);
  });

  it('flip is undoable — revert restores absence of the mirrored key (not mirrored:false)', async () => {
    const nest = baseNest();
    seed(nest);
    const cmd = new EditPlacedPanelCommand({
      materialId: 'm1', sheetIndex: 1, panelArrayIndex: 0,
      edit: { type: 'flip' },
    });
    await cmd.apply();
    await cmd.revert();
    const panel = useAppStore.getState().activeAssembly!.nest!.sheets[0]!.panels[0]!;
    expect('mirrored' in panel).toBe(false);
    expect(useAppStore.getState().activeAssembly!.nest).toEqual(nest);
  });

  it('flip toggling twice returns mirrored to absent again', async () => {
    seed(baseNest());
    const cmd1 = new EditPlacedPanelCommand({
      materialId: 'm1', sheetIndex: 1, panelArrayIndex: 0, edit: { type: 'flip' },
    });
    await cmd1.apply();
    const cmd2 = new EditPlacedPanelCommand({
      materialId: 'm1', sheetIndex: 1, panelArrayIndex: 0, edit: { type: 'flip' },
    });
    await cmd2.apply();
    const panel = useAppStore.getState().activeAssembly!.nest!.sheets[0]!.panels[0]!;
    expect('mirrored' in panel).toBe(false);
  });

  it('move producing overlap is rejected with zero state mutation', async () => {
    const nest = baseNest();
    seed(nest);
    const cmd = new EditPlacedPanelCommand({
      materialId: 'm1', sheetIndex: 1, panelArrayIndex: 0,
      // panel0 is 600x400 at (0,0); panel1 is 300x200 at (700,0).
      // Moving panel0 by dx=650 puts it at (650,0)-(1250,400), overlapping panel1 (700,0)-(1000,200).
      edit: { type: 'move', dx: 650, dy: 0 },
    });
    await expect(cmd.apply()).rejects.toThrow(EditRejectedError);
    expect(useAppStore.getState().activeAssembly!.nest).toEqual(nest);
  });

  it('move producing out-of-bounds placement is rejected with zero state mutation', async () => {
    const nest = baseNest();
    seed(nest);
    const cmd = new EditPlacedPanelCommand({
      materialId: 'm1', sheetIndex: 1, panelArrayIndex: 0,
      edit: { type: 'move', dx: -50, dy: 0 },
    });
    await expect(cmd.apply()).rejects.toThrow(EditRejectedError);
    expect(useAppStore.getState().activeAssembly!.nest).toEqual(nest);
  });

  it('rejects with reason "bounds" for out-of-bounds and "overlap" for overlap', async () => {
    seed(baseNest());
    const boundsCmd = new EditPlacedPanelCommand({
      materialId: 'm1', sheetIndex: 1, panelArrayIndex: 0, edit: { type: 'move', dx: -50, dy: 0 },
    });
    await expect(boundsCmd.apply()).rejects.toMatchObject({ reason: 'bounds' });

    seed(baseNest());
    const overlapCmd = new EditPlacedPanelCommand({
      materialId: 'm1', sheetIndex: 1, panelArrayIndex: 0, edit: { type: 'move', dx: 650, dy: 0 },
    });
    await expect(overlapCmd.apply()).rejects.toMatchObject({ reason: 'overlap' });
  });
});
