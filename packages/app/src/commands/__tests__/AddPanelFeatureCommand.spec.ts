import { describe, it, expect, beforeEach } from 'vitest';
import type { PanelFeature, PartDocument } from '@zilventor/shared';
import { newPart } from '@zilventor/kernel/src/adapter/PartDocument';
import { useAppStore } from '../../store/useAppStore';
import { AddPanelFeatureCommand } from '../AddPanelFeatureCommand';

const PANEL: PanelFeature = {
  kind: 'panel',
  id: 'pf-1',
  length: { kind: 'literal', value: 600 },
  width: { kind: 'literal', value: 400 },
  thickness: { kind: 'literal', value: 18 },
  thicknessFromMaterial: true,
  materialId: 'mat-1',
  grain: 'length',
  edgeBands: { front: null, back: null, left: null, right: null },
};

describe('AddPanelFeatureCommand', () => {
  beforeEach(() => {
    useAppStore.getState().setActivePart(newPart('P1'));
  });

  it('inserts panel as the first user feature of an empty part', async () => {
    await new AddPanelFeatureCommand(PANEL).apply();
    const part = useAppStore.getState().activePart!;
    const userFeatures = part.featureTree.filter((f) => !f.id.startsWith('origin.'));
    expect(userFeatures).toHaveLength(1);
    expect(userFeatures[0]!.kind).toBe('panel');
    expect(userFeatures[0]!.id).toBe('pf-1');
  });

  it('rejects when the active part already has a user feature', async () => {
    const part = useAppStore.getState().activePart!;
    const withSketch: PartDocument = {
      ...part,
      featureTree: [
        ...part.featureTree,
        { kind: 'sketch', id: 'S1', plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [], constraints: [] },
      ],
    };
    useAppStore.getState().setActivePart(withSketch);
    await expect(new AddPanelFeatureCommand(PANEL).apply()).rejects.toThrow(/PART_NOT_EMPTY/);
  });

  it('revert removes the panel', async () => {
    const cmd = new AddPanelFeatureCommand(PANEL);
    await cmd.apply();
    await cmd.revert();
    const part = useAppStore.getState().activePart!;
    const userFeatures = part.featureTree.filter((f) => !f.id.startsWith('origin.'));
    expect(userFeatures).toHaveLength(0);
  });

  it('throws NO_ACTIVE_PART when no part is active', async () => {
    useAppStore.getState().setActivePart(null);
    await expect(new AddPanelFeatureCommand(PANEL).apply()).rejects.toThrow(/NO_ACTIVE_PART/);
  });
});
