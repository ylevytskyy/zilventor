import { describe, it, expect } from 'vitest';
import { computeExpectedPose, needsPoseRepair } from '../repairCabinetPose';
import { localQuatFromEulerXYZ } from '../rolePose';
import type { ComponentInstance, Vec3 } from '../../types';

/**
 * Locking tests for the cabinet-pose repair helpers. Expected translation
 * numbers are transcribed from the same fixtures used by
 * baseCabinetPose.spec.ts / cornerCabinetPose.spec.ts /
 * blindCornerCabinetPose.spec.ts / diagonalCornerCabinetPose.spec.ts (already
 * the verified ground truth for these templates) — this spec does not
 * re-derive the physics, it locks that `computeExpectedPose` reproduces the
 * same formulas from a bare (role, fileNameSuffix, position, dims) input.
 */

function expectRot(quaternion: readonly number[], rx: number, ry: number, rz: number): void {
  const expected = localQuatFromEulerXYZ(rx, ry, rz);
  expect(quaternion[0]).toBeCloseTo(expected[0], 9);
  expect(quaternion[1]).toBeCloseTo(expected[1], 9);
  expect(quaternion[2]).toBeCloseTo(expected[2], 9);
  expect(quaternion[3]).toBeCloseTo(expected[3], 9);
}

function expectVec3(actual: Vec3, expected: Vec3): void {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
  expect(actual.z).toBeCloseTo(expected.z, 9);
}

describe('computeExpectedPose — baseCabinet fixture (W=600 D=560 H=720 Tc=18 Tb=6 tkH=100 tkS=50)', () => {
  it('Left Side', () => {
    const pose = computeExpectedPose({
      role: 'leftSide', fileNameSuffix: 'Left Side',
      position: { x: 0, y: 0, z: 0 }, dims: { length: 720, width: 560, thickness: 18 },
    });
    expect(pose).not.toBeNull();
    expectVec3(pose!.translation, { x: 0, y: 280, z: 360 });
    expectRot(pose!.quaternion, 0, 90, 0);
  });

  it('Right Side', () => {
    const pose = computeExpectedPose({
      role: 'rightSide', fileNameSuffix: 'Right Side',
      position: { x: 582, y: 0, z: 0 }, dims: { length: 720, width: 560, thickness: 18 },
    });
    expectVec3(pose!.translation, { x: 582, y: 280, z: 360 });
    expectRot(pose!.quaternion, 0, 90, 0);
  });

  it('Bottom', () => {
    const pose = computeExpectedPose({
      role: 'bottom', fileNameSuffix: 'Bottom',
      position: { x: 18, y: 6, z: 100 }, dims: { length: 564, width: 554, thickness: 18 },
    });
    expectVec3(pose!.translation, { x: 300, y: 283, z: 100 });
    expectRot(pose!.quaternion, 0, 0, 0);
  });

  it('Top', () => {
    const pose = computeExpectedPose({
      role: 'top', fileNameSuffix: 'Top',
      position: { x: 18, y: 6, z: 702 }, dims: { length: 564, width: 554, thickness: 18 },
    });
    expectVec3(pose!.translation, { x: 300, y: 283, z: 702 });
    expectRot(pose!.quaternion, 0, 0, 0);
  });

  it('Back', () => {
    const pose = computeExpectedPose({
      role: 'back', fileNameSuffix: 'Back',
      position: { x: 0, y: 0, z: 0 }, dims: { length: 600, width: 720, thickness: 6 },
    });
    expectVec3(pose!.translation, { x: 300, y: 6, z: 360 });
    expectRot(pose!.quaternion, 90, 0, 0);
  });

  it('Toekick', () => {
    const pose = computeExpectedPose({
      role: 'toekick', fileNameSuffix: 'Toekick',
      position: { x: 18, y: 492, z: 0 }, dims: { length: 564, width: 100, thickness: 18 },
    });
    expectVec3(pose!.translation, { x: 300, y: 492, z: 50 });
    expectRot(pose!.quaternion, -90, 0, 0);
  });

  it('Hanging Rail', () => {
    const pose = computeExpectedPose({
      role: 'hangingRail', fileNameSuffix: 'Hanging Rail',
      position: { x: 18, y: 6, z: 622 }, dims: { length: 564, width: 80, thickness: 18 },
    });
    expectVec3(pose!.translation, { x: 300, y: 6, z: 662 });
    expectRot(pose!.quaternion, -90, 0, 0);
  });

  it('Shelf 1', () => {
    const pose = computeExpectedPose({
      role: 'shelf', fileNameSuffix: 'Shelf 1',
      position: { x: 18, y: 6, z: 410 }, dims: { length: 564, width: 534, thickness: 18 },
    });
    expectVec3(pose!.translation, { x: 300, y: 273, z: 410 });
    expectRot(pose!.quaternion, 0, 0, 0);
  });

  it('Shelf N pattern matches multi-digit shelf indices too', () => {
    const pose = computeExpectedPose({
      role: 'shelf', fileNameSuffix: 'Shelf 12',
      position: { x: 18, y: 6, z: 410 }, dims: { length: 564, width: 534, thickness: 18 },
    });
    expect(pose).not.toBeNull();
  });
});

describe('computeExpectedPose — cornerCabinet fixture (W1=900 D1=350 W2=600 D2=350 H=720 Tc=18 Tb=6)', () => {
  it('Leg 1 End', () => {
    const pose = computeExpectedPose({
      role: 'rightSide', fileNameSuffix: 'Leg 1 End',
      position: { x: 882, y: 0, z: 0 }, dims: { length: 720, width: 350, thickness: 18 },
    });
    expectVec3(pose!.translation, { x: 882, y: 175, z: 360 });
    expectRot(pose!.quaternion, 0, 90, 0);
  });

  it('Leg 2 End (different formula than Left/Right Side despite role leftSide)', () => {
    const pose = computeExpectedPose({
      role: 'leftSide', fileNameSuffix: 'Leg 2 End',
      position: { x: 0, y: 582, z: 0 }, dims: { length: 720, width: 350, thickness: 18 },
    });
    expectVec3(pose!.translation, { x: 175, y: 582, z: 360 });
    expectRot(pose!.quaternion, -90, 0, -90);
  });

  it('Back 1', () => {
    const pose = computeExpectedPose({
      role: 'back', fileNameSuffix: 'Back 1',
      position: { x: 0, y: 0, z: 0 }, dims: { length: 900, width: 720, thickness: 6 },
    });
    expectVec3(pose!.translation, { x: 450, y: 6, z: 360 });
    expectRot(pose!.quaternion, 90, 0, 0);
  });

  it('Back 2 (different formula than Back 1)', () => {
    const pose = computeExpectedPose({
      role: 'back', fileNameSuffix: 'Back 2',
      position: { x: 0, y: 0, z: 0 }, dims: { length: 600, width: 720, thickness: 6 },
    });
    expectVec3(pose!.translation, { x: 0, y: 300, z: 360 });
    expectRot(pose!.quaternion, 0, 90, 90);
  });

  it('Bottom 1', () => {
    const pose = computeExpectedPose({
      role: 'bottom', fileNameSuffix: 'Bottom 1',
      position: { x: 0, y: 0, z: 0 }, dims: { length: 900, width: 350, thickness: 18 },
    });
    expectVec3(pose!.translation, { x: 450, y: 175, z: 0 });
  });

  it('Bottom 2', () => {
    const pose = computeExpectedPose({
      role: 'bottom', fileNameSuffix: 'Bottom 2',
      position: { x: 0, y: 350, z: 0 }, dims: { length: 350, width: 250, thickness: 18 },
    });
    expectVec3(pose!.translation, { x: 175, y: 475, z: 0 });
  });

  it('Top 1', () => {
    const pose = computeExpectedPose({
      role: 'top', fileNameSuffix: 'Top 1',
      position: { x: 0, y: 0, z: 702 }, dims: { length: 900, width: 350, thickness: 18 },
    });
    expectVec3(pose!.translation, { x: 450, y: 175, z: 702 });
  });

  it('Top 2', () => {
    const pose = computeExpectedPose({
      role: 'top', fileNameSuffix: 'Top 2',
      position: { x: 0, y: 350, z: 702 }, dims: { length: 350, width: 250, thickness: 18 },
    });
    expectVec3(pose!.translation, { x: 175, y: 475, z: 702 });
  });

  it('Corner Post', () => {
    const pose = computeExpectedPose({
      role: 'cornerPost', fileNameSuffix: 'Corner Post',
      position: { x: 332, y: 332, z: 0 }, dims: { length: 720, width: 18, thickness: 18 },
    });
    expectVec3(pose!.translation, { x: 332, y: 341, z: 360 });
    expectRot(pose!.quaternion, 0, 90, 0);
  });
});

describe('computeExpectedPose — blindCornerCabinet fixture (W=900 D=560 H=720 Tc=18 Tb=6 tkH=100 tkS=60 openingWidth=450 blindSide=left)', () => {
  it('Left Side', () => {
    const pose = computeExpectedPose({
      role: 'leftSide', fileNameSuffix: 'Left Side',
      position: { x: 0, y: 0, z: 0 }, dims: { length: 720, width: 560, thickness: 18 },
    });
    expectVec3(pose!.translation, { x: 0, y: 280, z: 360 });
    expectRot(pose!.quaternion, 0, 90, 0);
  });

  it('Right Side', () => {
    const pose = computeExpectedPose({
      role: 'rightSide', fileNameSuffix: 'Right Side',
      position: { x: 882, y: 0, z: 0 }, dims: { length: 720, width: 560, thickness: 18 },
    });
    expectVec3(pose!.translation, { x: 882, y: 280, z: 360 });
    expectRot(pose!.quaternion, 0, 90, 0);
  });

  it('Bottom', () => {
    const pose = computeExpectedPose({
      role: 'bottom', fileNameSuffix: 'Bottom',
      position: { x: 18, y: 6, z: 100 }, dims: { length: 864, width: 554, thickness: 18 },
    });
    expectVec3(pose!.translation, { x: 450, y: 283, z: 100 });
    expectRot(pose!.quaternion, 0, 0, 0);
  });

  it('Top', () => {
    const pose = computeExpectedPose({
      role: 'top', fileNameSuffix: 'Top',
      position: { x: 18, y: 6, z: 702 }, dims: { length: 864, width: 554, thickness: 18 },
    });
    expectVec3(pose!.translation, { x: 450, y: 283, z: 702 });
  });

  it('Back', () => {
    const pose = computeExpectedPose({
      role: 'back', fileNameSuffix: 'Back',
      position: { x: 18, y: 0, z: 18 }, dims: { length: 864, width: 684, thickness: 6 },
    });
    expectVec3(pose!.translation, { x: 450, y: 6, z: 360 });
    expectRot(pose!.quaternion, 90, 0, 0);
  });

  it('Toekick', () => {
    const pose = computeExpectedPose({
      role: 'toekick', fileNameSuffix: 'Toekick',
      position: { x: 18, y: 482, z: 0 }, dims: { length: 864, width: 100, thickness: 18 },
    });
    expectVec3(pose!.translation, { x: 450, y: 482, z: 50 });
    expectRot(pose!.quaternion, -90, 0, 0);
  });

  it('Blind Filler (blindSide=left)', () => {
    const pose = computeExpectedPose({
      role: 'blindFiller', fileNameSuffix: 'Blind Filler',
      position: { x: 18, y: 128, z: 18 }, dims: { length: 684, width: 432, thickness: 18 },
    });
    expectVec3(pose!.translation, { x: 18, y: 344, z: 360 });
    expectRot(pose!.quaternion, 0, 90, 0);
  });

  it('Blind Filler (blindSide=right, position.x differs but formula is the same)', () => {
    const pose = computeExpectedPose({
      role: 'blindFiller', fileNameSuffix: 'Blind Filler',
      position: { x: 450, y: 128, z: 18 }, dims: { length: 684, width: 432, thickness: 18 },
    });
    expectVec3(pose!.translation, { x: 450, y: 344, z: 360 });
    expectRot(pose!.quaternion, 0, 90, 0);
  });

  it('Shelf 1 (no depth shrink, unlike baseCabinet)', () => {
    const pose = computeExpectedPose({
      role: 'shelf', fileNameSuffix: 'Shelf 1',
      position: { x: 18, y: 6, z: 410 }, dims: { length: 864, width: 554, thickness: 18 },
    });
    expectVec3(pose!.translation, { x: 450, y: 283, z: 410 });
    expectRot(pose!.quaternion, 0, 0, 0);
  });

  it('Door is ambiguous with diagonalCornerCabinet\'s Door and returns null', () => {
    const pose = computeExpectedPose({
      role: 'door', fileNameSuffix: 'Door',
      position: { x: 225, y: 560, z: 360 }, dims: { length: 714, width: 448, thickness: 18 },
    });
    expect(pose).toBeNull();
  });
});

describe('computeExpectedPose — diagonalCornerCabinet fixture (W1=W2=900 D1=D2=560 H=720 Tc=18 Tb=6 tkH=100)', () => {
  it('Bottom', () => {
    const pose = computeExpectedPose({
      role: 'bottom', fileNameSuffix: 'Bottom',
      position: { x: 0, y: 0, z: 0 }, dims: { length: 900, width: 900, thickness: 18 },
    });
    expectVec3(pose!.translation, { x: 450, y: 450, z: 0 });
    expectRot(pose!.quaternion, 0, 0, 0);
  });

  it('Top', () => {
    const pose = computeExpectedPose({
      role: 'top', fileNameSuffix: 'Top',
      position: { x: 0, y: 0, z: 702 }, dims: { length: 900, width: 900, thickness: 18 },
    });
    expectVec3(pose!.translation, { x: 450, y: 450, z: 702 });
  });

  it('Back 1', () => {
    const pose = computeExpectedPose({
      role: 'back', fileNameSuffix: 'Back 1',
      position: { x: 0, y: 0, z: 18 }, dims: { length: 900, width: 720, thickness: 6 },
    });
    expectVec3(pose!.translation, { x: 450, y: 6, z: 378 });
    expectRot(pose!.quaternion, 90, 0, 0);
  });

  it('Back 2', () => {
    const pose = computeExpectedPose({
      role: 'back', fileNameSuffix: 'Back 2',
      position: { x: 0, y: 0, z: 18 }, dims: { length: 900, width: 720, thickness: 6 },
    });
    expectVec3(pose!.translation, { x: 0, y: 450, z: 378 });
    expectRot(pose!.quaternion, 0, 90, 90);
  });

  it('Return Side 1', () => {
    const pose = computeExpectedPose({
      role: 'leftSide', fileNameSuffix: 'Return Side 1',
      position: { x: 882, y: 0, z: 0 }, dims: { length: 720, width: 560, thickness: 18 },
    });
    expectVec3(pose!.translation, { x: 882, y: 280, z: 360 });
    expectRot(pose!.quaternion, 0, 90, 0);
  });

  it('Return Side 2', () => {
    const pose = computeExpectedPose({
      role: 'rightSide', fileNameSuffix: 'Return Side 2',
      position: { x: 0, y: 882, z: 0 }, dims: { length: 720, width: 560, thickness: 18 },
    });
    expectVec3(pose!.translation, { x: 280, y: 882, z: 360 });
    expectRot(pose!.quaternion, -90, 0, -90);
  });

  it('Toekick 1', () => {
    const pose = computeExpectedPose({
      role: 'toekick', fileNameSuffix: 'Toekick 1',
      position: { x: 18, y: 0, z: 0 }, dims: { length: 864, width: 100, thickness: 18 },
    });
    expectVec3(pose!.translation, { x: 450, y: 0, z: 50 });
    expectRot(pose!.quaternion, -90, 0, 0);
  });

  it('Toekick 2 (different formula than Toekick 1 despite role toekick)', () => {
    const pose = computeExpectedPose({
      role: 'toekick', fileNameSuffix: 'Toekick 2',
      position: { x: 0, y: 18, z: 0 }, dims: { length: 864, width: 100, thickness: 18 },
    });
    expectVec3(pose!.translation, { x: 0, y: 450, z: 50 });
    expectRot(pose!.quaternion, 0, 90, 90);
  });

  it('Front Stile 1 is not recoverable (ry depends on pentagon leg geometry) — null', () => {
    const pose = computeExpectedPose({
      role: 'frontStile', fileNameSuffix: 'Front Stile 1',
      position: { x: 888.66, y: 584.04, z: 360 }, dims: { length: 718, width: 50, thickness: 18 },
    });
    expect(pose).toBeNull();
  });

  it('Front Stile 2 is not recoverable — null', () => {
    const pose = computeExpectedPose({
      role: 'frontStile', fileNameSuffix: 'Front Stile 2',
      position: { x: 584.04, y: 888.66, z: 360 }, dims: { length: 718, width: 50, thickness: 18 },
    });
    expect(pose).toBeNull();
  });

  it('Door is not recoverable (shares suffix+role with blindCorner Door, ambiguous) — null', () => {
    const pose = computeExpectedPose({
      role: 'door', fileNameSuffix: 'Door',
      position: { x: 736.36, y: 736.36, z: 360 }, dims: { length: 718, width: 280.83, thickness: 18 },
    });
    expect(pose).toBeNull();
  });
});

describe('computeExpectedPose — unrecognized / mismatched input', () => {
  it('an unrecognized suffix (e.g. a drawer-bank child) returns null', () => {
    const pose = computeExpectedPose({
      role: 'drawerBox-side', fileNameSuffix: 'Drawer Box 1 - Side Left',
      position: { x: 10, y: 10, z: 10 }, dims: { length: 400, width: 300, thickness: 12 },
    });
    expect(pose).toBeNull();
  });

  it('a recognized suffix whose role does not match the expected role returns null', () => {
    const pose = computeExpectedPose({
      role: 'top', fileNameSuffix: 'Bottom', // 'Bottom' expects role 'bottom'
      position: { x: 18, y: 6, z: 100 }, dims: { length: 564, width: 554, thickness: 18 },
    });
    expect(pose).toBeNull();
  });

  it('does not mutate the input position or dims', () => {
    const position = { x: 18, y: 6, z: 100 };
    const dims = { length: 564, width: 554, thickness: 18 };
    const positionSnapshot = { ...position };
    const dimsSnapshot = { ...dims };
    computeExpectedPose({ role: 'bottom', fileNameSuffix: 'Bottom', position, dims });
    expect(position).toEqual(positionSnapshot);
    expect(dims).toEqual(dimsSnapshot);
  });
});

describe('needsPoseRepair', () => {
  const expectedLeftSide = computeExpectedPose({
    role: 'leftSide', fileNameSuffix: 'Left Side',
    position: { x: 0, y: 0, z: 0 }, dims: { length: 720, width: 560, thickness: 18 },
  })!;

  function baseComponent(overrides: Partial<ComponentInstance> = {}): ComponentInstance {
    return {
      id: 'c1',
      partPath: 'Base Cabinet 1 - Left Side.zipt',
      position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
      role: 'leftSide',
      ...overrides,
    };
  }

  it('flags a legacy component backfilled with identity pose (position, [0,0,0,1])', () => {
    const component = baseComponent({
      pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
    });
    expect(needsPoseRepair(component, expectedLeftSide)).toBe(true);
  });

  it('does not flag a freshly-built component whose pose already matches expected', () => {
    const component = baseComponent({
      pose: { translation: { ...expectedLeftSide.translation }, quaternion: [...expectedLeftSide.quaternion] as typeof expectedLeftSide.quaternion },
    });
    expect(needsPoseRepair(component, expectedLeftSide)).toBe(false);
  });

  it('flags a component with no pose field at all when a pose is expected', () => {
    const component = baseComponent(); // no `pose` override — absent, not undefined
    expect(needsPoseRepair(component, expectedLeftSide)).toBe(true);
  });

  it('never flags when expected is null (unrecognized/foreign component)', () => {
    const component = baseComponent({
      pose: { translation: { x: 999, y: 999, z: 999 }, quaternion: [0, 0, 0, 1] },
    });
    expect(needsPoseRepair(component, null)).toBe(false);
  });

  it('epsilon boundary: a diff exactly at epsilonMm is NOT flagged', () => {
    const component = baseComponent({
      pose: {
        translation: { x: expectedLeftSide.translation.x + 1e-3, y: expectedLeftSide.translation.y, z: expectedLeftSide.translation.z },
        quaternion: [...expectedLeftSide.quaternion] as typeof expectedLeftSide.quaternion,
      },
    });
    expect(needsPoseRepair(component, expectedLeftSide, 1e-3)).toBe(false);
  });

  it('epsilon boundary: a diff just over epsilonMm IS flagged', () => {
    const component = baseComponent({
      pose: {
        translation: { x: expectedLeftSide.translation.x + 1.1e-3, y: expectedLeftSide.translation.y, z: expectedLeftSide.translation.z },
        quaternion: [...expectedLeftSide.quaternion] as typeof expectedLeftSide.quaternion,
      },
    });
    expect(needsPoseRepair(component, expectedLeftSide, 1e-3)).toBe(true);
  });

  it('uses the default epsilonMm (1e-3) when not passed', () => {
    const component = baseComponent({
      pose: {
        translation: { x: expectedLeftSide.translation.x + 5e-4, y: expectedLeftSide.translation.y, z: expectedLeftSide.translation.z },
        quaternion: [...expectedLeftSide.quaternion] as typeof expectedLeftSide.quaternion,
      },
    });
    expect(needsPoseRepair(component, expectedLeftSide)).toBe(false);
  });

  it('does not mutate the component or expected pose', () => {
    const component = baseComponent({
      pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
    });
    const componentSnapshot = JSON.parse(JSON.stringify(component));
    const expectedSnapshot = JSON.parse(JSON.stringify(expectedLeftSide));
    needsPoseRepair(component, expectedLeftSide);
    expect(component).toEqual(componentSnapshot);
    expect(expectedLeftSide).toEqual(expectedSnapshot);
  });
});
