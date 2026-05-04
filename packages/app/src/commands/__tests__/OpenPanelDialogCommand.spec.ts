import { describe, it, expect, beforeEach } from 'vitest';
import type { AssemblyDocument, PartDocument } from '@zilventor/shared';
import { newPart } from '@zilventor/kernel/src/adapter/PartDocument';
import { useAppStore } from '../../store/useAppStore';
import { OpenPanelDialogCommand } from '../OpenPanelDialogCommand';

const emptyAssembly = (): AssemblyDocument => ({
  id: 'A', name: 'A', units: 'mm', parameters: {}, properties: {},
  components: [], constraints: [], groundedComponentPaths: [],
  colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
  materials: [],
  hardware: [],
});

describe('OpenPanelDialogCommand', () => {
  beforeEach(() => {
    useAppStore.getState().setPanelDialog(null);
  });

  it("part-mode: opens dialog with mode='part' when active part is empty", async () => {
    useAppStore.getState().setActivePart(newPart('P1'));
    const onSubmit = () => {};
    await new OpenPanelDialogCommand({ onSubmit }).apply();
    const slot = useAppStore.getState().panelDialog;
    expect(slot).not.toBeNull();
    expect(slot!.mode).toBe('part');
    expect(slot!.onSubmit).toBe(onSubmit);
  });

  it("assembly-mode: opens dialog with mode='assembly' when an assembly is active", async () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: emptyAssembly() });
    await new OpenPanelDialogCommand({ onSubmit: () => {} }).apply();
    const slot = useAppStore.getState().panelDialog;
    expect(slot).not.toBeNull();
    expect(slot!.mode).toBe('assembly');
  });

  it('throws PART_NOT_EMPTY when active part already has a user feature', async () => {
    const part = newPart('P1');
    const withSketch: PartDocument = {
      ...part,
      featureTree: [
        ...part.featureTree,
        { kind: 'sketch', id: 'S1', plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [], constraints: [] },
      ],
    };
    useAppStore.getState().setActivePart(withSketch);
    await expect(new OpenPanelDialogCommand({ onSubmit: () => {} }).apply()).rejects.toThrow(/PART_NOT_EMPTY/);
    expect(useAppStore.getState().panelDialog).toBeNull();
  });
});
