import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { EditComponentCommand } from '../EditComponentCommand';
import type { AssemblyDocument, ComponentInstance } from '@zilventor/shared';

describe('EditComponentCommand', () => {
  const original: ComponentInstance = {
    id: 'C1', partPath: 'leg.zipt',
    position: { x: 0, y: 0, z: 0 },
    rotation: { rx: 0, ry: 0, rz: 0 },
    visible: true,
  };

  beforeEach(() => {
    const asm: AssemblyDocument = {
      id: 'A1', name: 'a', units: 'mm', parameters: {}, properties: {},
      components: [{ ...original }],
      constraints: [],
      groundedComponentPaths: [],
      colors: {},
      bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [],
      hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
  });

  it('apply() updates position and rotation', async () => {
    const cmd = new EditComponentCommand({
      id: 'C1',
      patch: { position: { x: 50, y: 0, z: 0 } },
    });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly?.components[0]!.position.x).toBe(50);
  });

  it('revert() restores original values', async () => {
    const cmd = new EditComponentCommand({
      id: 'C1',
      patch: { position: { x: 50, y: 0, z: 0 } },
    });
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly?.components[0]!.position.x).toBe(0);
  });

  describe('stale-pose foot-gun', () => {
    const withPose: ComponentInstance = {
      ...original,
      pose: {
        translation: { x: 1, y: 2, z: 3 },
        quaternion: [0.1, 0.2, 0.3, 0.9],
      },
    };

    beforeEach(() => {
      const asm: AssemblyDocument = {
        id: 'A1', name: 'a', units: 'mm', parameters: {}, properties: {},
        components: [{ ...withPose, pose: { ...withPose.pose! } }],
        constraints: [],
        groundedComponentPaths: [],
        colors: {},
        bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
        materials: [],
        hardware: [],
      };
      useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    });

    it('apply() deletes the pose key when patch touches rotation', async () => {
      const cmd = new EditComponentCommand({
        id: 'C1',
        patch: { rotation: { rx: 90, ry: 0, rz: 0 } },
      });
      await cmd.apply();
      const c = useAppStore.getState().activeAssembly?.components[0]!;
      expect('pose' in c).toBe(false);
      expect(c.rotation.rx).toBe(90);
    });

    it('revert() restores the exact prior component including pose', async () => {
      const cmd = new EditComponentCommand({
        id: 'C1',
        patch: { rotation: { rx: 90, ry: 0, rz: 0 } },
      });
      await cmd.apply();
      await cmd.revert();
      const c = useAppStore.getState().activeAssembly?.components[0]!;
      expect(c.pose).toEqual(withPose.pose);
      expect(c.rotation).toEqual({ rx: 0, ry: 0, rz: 0 });
    });

    it('apply() does NOT delete pose when patch only touches visible', async () => {
      const cmd = new EditComponentCommand({
        id: 'C1',
        patch: { visible: false },
      });
      await cmd.apply();
      const c = useAppStore.getState().activeAssembly?.components[0]!;
      expect('pose' in c).toBe(true);
      expect(c.pose).toEqual(withPose.pose);
      expect(c.visible).toBe(false);
    });
  });
});
