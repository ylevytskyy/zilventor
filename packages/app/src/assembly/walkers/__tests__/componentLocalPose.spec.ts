import { describe, expect, it } from 'vitest';
import type { ComponentInstance } from '@zilventor/shared';
import { quatFromEulerXYZ } from '@zilventor/kernel/src/assembly/quat';
import { componentLocalPose } from '../componentLocalPose';

function component(over: Partial<ComponentInstance> = {}): ComponentInstance {
  return {
    id: 'a', partPath: 'p.zipt',
    position: { x: 0, y: 0, z: 0 },
    rotation: { rx: 0, ry: 0, rz: 0 },
    visible: true,
    ...over,
  };
}

describe('componentLocalPose', () => {
  it('returns c.pose verbatim when present', () => {
    const c = component({
      position: { x: 1, y: 2, z: 3 },
      rotation: { rx: 90, ry: 0, rz: 0 },
      pose: { translation: { x: 100, y: 200, z: 300 }, quaternion: [0.1, 0.2, 0.3, 0.4] },
    });
    const p = componentLocalPose(c);
    expect(p).toEqual(c.pose);
  });

  it('derives quaternion from rotation when pose is absent (non-trivial rotation)', () => {
    const c = component({
      position: { x: 5, y: 6, z: 7 },
      rotation: { rx: -90, ry: 0, rz: -90 },
    });
    const p = componentLocalPose(c);
    const expected = quatFromEulerXYZ(-90, 0, -90);
    expect(p.translation).toEqual({ x: 5, y: 6, z: 7 });
    expect(p.quaternion[0]).toBeCloseTo(expected[0]);
    expect(p.quaternion[1]).toBeCloseTo(expected[1]);
    expect(p.quaternion[2]).toBeCloseTo(expected[2]);
    expect(p.quaternion[3]).toBeCloseTo(expected[3]);
  });

  it('derives identity quaternion when pose is absent and rotation is zero', () => {
    const c = component({ rotation: { rx: 0, ry: 0, rz: 0 } });
    const p = componentLocalPose(c);
    expect(p.quaternion[0]).toBeCloseTo(0);
    expect(p.quaternion[1]).toBeCloseTo(0);
    expect(p.quaternion[2]).toBeCloseTo(0);
    expect(p.quaternion[3]).toBeCloseTo(1);
  });
});
