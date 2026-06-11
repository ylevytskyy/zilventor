// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { CreateCircularPatternCommand } from '../CreateCircularPatternCommand';
import type { AssemblyDocument, ComponentInstance } from '@zilventor/shared';

function srcInstance(): ComponentInstance {
  return {
    id: 'src-1', partPath: 'leg.zipt',
    position: { x: 2, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 },
    visible: true, pose: { translation: { x: 2, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
  };
}

function makeAsm(components: AssemblyDocument['components'] = []): AssemblyDocument {
  return {
    id: 'asm1', name: 'test-asm', units: 'mm', parameters: {}, properties: {},
    components, constraints: [], groundedComponentPaths: [], colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
  };
}

function seedAssembly(src: ComponentInstance): void {
  useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeAsm([src]) });
}

const comps = () => useAppStore.getState().activeAssembly!.components;

describe('CreateCircularPatternCommand', () => {
  beforeEach(() => seedAssembly(srcInstance()));

  it('full circle count=4 → adds 3 instances on the circle, sharing partPath', async () => {
    const cmd = new CreateCircularPatternCommand({ sourceInstanceId: 'src-1', axis: 'z', center: { x: 0, y: 0, z: 0 }, count: 4, totalAngleDeg: 360, rotateInstances: true });
    await cmd.apply();
    const added = comps().filter((c) => c.id !== 'src-1');
    expect(added).toHaveLength(3);
    for (const c of added) {
      expect(c.partPath).toBe('leg.zipt');
      expect(Math.hypot(c.pose!.translation.x, c.pose!.translation.y)).toBeCloseTo(2, 6);
    }
  });

  it('off-center: instances orbit the center, not origin (threads center)', async () => {
    const src = srcInstance();
    src.position = { x: 3, y: 0, z: 0 };
    src.pose = { translation: { x: 3, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] };
    seedAssembly(src);
    const cmd = new CreateCircularPatternCommand({ sourceInstanceId: 'src-1', axis: 'z', center: { x: 1, y: 0, z: 0 }, count: 4, totalAngleDeg: 360, rotateInstances: false });
    await cmd.apply();
    for (const c of comps().filter((c) => c.id !== 'src-1')) {
      expect(Math.hypot(c.pose!.translation.x - 1, c.pose!.translation.y)).toBeCloseTo(2, 6);
    }
  });

  it('rotateInstances=false threads through → instance quats === source', async () => {
    const cmd = new CreateCircularPatternCommand({ sourceInstanceId: 'src-1', axis: 'z', center: { x: 0, y: 0, z: 0 }, count: 4, totalAngleDeg: 360, rotateInstances: false });
    await cmd.apply();
    for (const c of comps().filter((c) => c.id !== 'src-1')) expect(c.pose!.quaternion).toEqual([0, 0, 0, 1]);
  });

  it('sets legacy rotation struct + visible + position mirror', async () => {
    const cmd = new CreateCircularPatternCommand({ sourceInstanceId: 'src-1', axis: 'z', center: { x: 0, y: 0, z: 0 }, count: 4, totalAngleDeg: 360, rotateInstances: false });
    await cmd.apply();
    const c = comps().find((c) => c.id !== 'src-1')!;
    expect(c.rotation).toEqual({ rx: 0, ry: 0, rz: 0 });
    expect(c.visible).toBe(true);
    expect(c.position).toEqual({ x: c.pose!.translation.x, y: c.pose!.translation.y, z: c.pose!.translation.z });
  });

  it('revert removes created instances', async () => {
    const cmd = new CreateCircularPatternCommand({ sourceInstanceId: 'src-1', axis: 'z', center: { x: 0, y: 0, z: 0 }, count: 4, totalAngleDeg: 360, rotateInstances: true });
    await cmd.apply();
    expect(comps()).toHaveLength(4);
    await cmd.revert();
    expect(comps()).toHaveLength(1);
  });

  it('noop when source instance missing', async () => {
    const cmd = new CreateCircularPatternCommand({ sourceInstanceId: 'nope', axis: 'z', center: { x: 0, y: 0, z: 0 }, count: 4, totalAngleDeg: 360, rotateInstances: true });
    await cmd.apply();
    expect(comps()).toHaveLength(1);
  });
});
