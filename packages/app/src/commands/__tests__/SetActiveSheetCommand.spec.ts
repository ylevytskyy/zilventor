// packages/app/src/commands/__tests__/SetActiveSheetCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { SetActiveSheetCommand } from '../SetActiveSheetCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument } from '@zilventor/shared';

const makeDrawing = (activeSheetId: string): DrawingDocument => ({
  id: 'd1', name: 'D', units: 'mm',
  source: { partPath: 'p.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [
    { id: 's1', name: 'Sheet 1', size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], annotations: [], titleBlock: {} },
    { id: 's2', name: 'Sheet 2', size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], annotations: [], titleBlock: {} },
  ],
  activeSheetId,
});

describe('SetActiveSheetCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDrawing: makeDrawing('s1') } as never);
  });

  it('apply sets activeSheetId on the drawing', async () => {
    const cmd = new SetActiveSheetCommand({ sheetId: 's2' });
    await cmd.apply();
    const d = useAppStore.getState().activeDrawing;
    expect(d?.activeSheetId).toBe('s2');
  });

  it('revert restores the prior activeSheetId', async () => {
    const cmd = new SetActiveSheetCommand({ sheetId: 's2' });
    await cmd.apply();
    await cmd.revert();
    const d = useAppStore.getState().activeDrawing;
    expect(d?.activeSheetId).toBe('s1');
  });

  it('apply is a no-op when no activeDrawing', async () => {
    useAppStore.setState({ activeDrawing: null } as never);
    const cmd = new SetActiveSheetCommand({ sheetId: 's2' });
    await expect(cmd.apply()).resolves.toBeUndefined();
  });
});
