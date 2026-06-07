import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { PanelFeature, PartDocument } from '@zilventor/shared';
import { newPart } from '@zilventor/kernel/src/adapter/PartDocument';
import { useAppStore } from '../../store/useAppStore';
import { AddPanelFeatureCommand } from '../AddPanelFeatureCommand';
import type { KernelClient } from '../../kernel-client/KernelClient';

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

describe('AddPanelFeatureCommand — kernel call ordering', () => {
  const callOrder: string[] = [];

  // A minimal mock kernel that records when addFeature / removeFeature are called.
  const mockKernel = {
    addFeature: vi.fn(async (_partId: string, _feature: unknown) => {
      callOrder.push('addFeature');
    }),
    removeFeature: vi.fn(async (_partId: string, _featureId: string) => {
      callOrder.push('removeFeature');
    }),
  } as unknown as KernelClient;

  beforeEach(() => {
    callOrder.length = 0;
    vi.clearAllMocks();

    // Seed a fresh empty part and install the mock kernel in the store.
    useAppStore.getState().setActivePart(newPart('P1'));
    useAppStore.getState().setKernel(mockKernel);

    // Spy on setActivePart: push 'setActivePart' into callOrder when it fires.
    vi.spyOn(useAppStore.getState(), 'setActivePart').mockImplementation((p) => {
      callOrder.push('setActivePart');
      // Delegate to the real implementation so the store is updated correctly.
      useAppStore.setState({ activePart: p, activeDocument: p ? { kind: 'part', document: p } : null, activeAssembly: null });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clear the kernel from the store so other test suites start clean.
    useAppStore.setState({ kernel: null, kernelReady: false });
  });

  it('apply() calls kernel.addFeature BEFORE setActivePart (no-solid race must not occur)', async () => {
    await new AddPanelFeatureCommand(PANEL).apply();

    // The kernel must have been synced BEFORE the store update fires.
    expect(callOrder).toEqual(['addFeature', 'setActivePart']);
    expect(mockKernel.addFeature).toHaveBeenCalledWith(
      expect.any(String), // partId
      expect.objectContaining({ kind: 'panel', id: 'pf-1' }),
    );
  });

  it('revert() calls kernel.removeFeature BEFORE setActivePart', async () => {
    const cmd = new AddPanelFeatureCommand(PANEL);
    // Apply first (with ordering assertions already covered above — just need a panel in the tree).
    await cmd.apply();
    // Clear order log for the revert phase.
    callOrder.length = 0;
    vi.clearAllMocks();

    await cmd.revert();

    expect(callOrder).toEqual(['removeFeature', 'setActivePart']);
    expect(mockKernel.removeFeature).toHaveBeenCalledWith(
      expect.any(String), // partId
      'pf-1',            // featureId
    );
  });
});
