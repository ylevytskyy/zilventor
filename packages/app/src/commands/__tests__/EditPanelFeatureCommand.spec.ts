import { describe, it, expect, beforeEach } from 'vitest';
import type { PanelFeature, PartDocument } from '@zilventor/shared';
import { newPart, addFeature } from '@zilventor/kernel/src/adapter/PartDocument';
import { useAppStore } from '../../store/useAppStore';
import { EditPanelFeatureCommand } from '../EditPanelFeatureCommand';

const makePanel = (overrides: Partial<PanelFeature> = {}): PanelFeature => ({
  kind: 'panel',
  id: 'pf-1',
  length: { kind: 'literal', value: 600 },
  width: { kind: 'literal', value: 400 },
  thickness: { kind: 'literal', value: 18 },
  thicknessFromMaterial: true,
  materialId: 'mat-1',
  grain: 'length',
  edgeBands: { front: null, back: null, left: null, right: null },
  ...overrides,
});

function findPanel(part: PartDocument, id: string): PanelFeature | undefined {
  return part.featureTree.find((f): f is PanelFeature => f.kind === 'panel' && f.id === id);
}

describe('EditPanelFeatureCommand', () => {
  beforeEach(() => {
    const seeded = addFeature(newPart('P1'), makePanel());
    useAppStore.getState().setActivePart(seeded);
  });

  it('replaces the panel in place with new dimensions/material', async () => {
    const updated = makePanel({
      length: { kind: 'literal', value: 800 },
      width: { kind: 'literal', value: 500 },
      materialId: 'mat-2',
    });
    await new EditPanelFeatureCommand(updated).apply();
    const panel = findPanel(useAppStore.getState().activePart!, 'pf-1')!;
    expect(panel.length).toEqual({ kind: 'literal', value: 800 });
    expect(panel.width).toEqual({ kind: 'literal', value: 500 });
    expect(panel.materialId).toBe('mat-2');
  });

  it('revert restores the prior panel', async () => {
    const updated = makePanel({ length: { kind: 'literal', value: 999 }, materialId: 'mat-99' });
    const cmd = new EditPanelFeatureCommand(updated);
    await cmd.apply();
    await cmd.revert();
    const panel = findPanel(useAppStore.getState().activePart!, 'pf-1')!;
    expect(panel.length).toEqual({ kind: 'literal', value: 600 });
    expect(panel.materialId).toBe('mat-1');
  });

  it('throws PANEL_NOT_FOUND when id does not match', async () => {
    const updated = makePanel({ id: 'pf-other' });
    await expect(new EditPanelFeatureCommand(updated).apply()).rejects.toThrow(/PANEL_NOT_FOUND/);
  });

  it('throws NO_ACTIVE_PART when no part is active', async () => {
    useAppStore.getState().setActivePart(null);
    await expect(new EditPanelFeatureCommand(makePanel()).apply()).rejects.toThrow(/NO_ACTIVE_PART/);
  });
});
