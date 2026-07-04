import { describe, it, expect, beforeEach } from 'vitest';
import type { PanelFeature, PartDocument } from '@zilventor/shared';
import { newPart, addFeature } from '@zilventor/kernel/src/adapter/PartDocument';
import { useAppStore } from '../../store/useAppStore';
import { DeletePanelFeatureCommand } from '../DeletePanelFeatureCommand';

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

describe('DeletePanelFeatureCommand', () => {
  beforeEach(() => {
    const seeded = addFeature(newPart('P1'), makePanel());
    useAppStore.getState().setActivePart(seeded);
  });

  it('removes the panel feature from the active part', async () => {
    await new DeletePanelFeatureCommand('pf-1').apply();
    const part = useAppStore.getState().activePart!;
    expect(findPanel(part, 'pf-1')).toBeUndefined();
  });

  it('revert restores the prior document', async () => {
    const cmd = new DeletePanelFeatureCommand('pf-1');
    await cmd.apply();
    await cmd.revert();
    const part = useAppStore.getState().activePart!;
    expect(findPanel(part, 'pf-1')).toBeTruthy();
  });

  it('throws PANEL_NOT_FOUND when id does not match', async () => {
    await expect(new DeletePanelFeatureCommand('pf-other').apply()).rejects.toThrow(/PANEL_NOT_FOUND/);
  });

  it('throws NO_ACTIVE_PART when no part is active', async () => {
    useAppStore.getState().setActivePart(null);
    await expect(new DeletePanelFeatureCommand('pf-1').apply()).rejects.toThrow(/NO_ACTIVE_PART/);
  });
});
