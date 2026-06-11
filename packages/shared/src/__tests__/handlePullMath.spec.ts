/**
 * TDD: RED-first test for handlePullPose.
 *
 * ORACLE is INDEPENDENT: expected values are derived by hand from first principles.
 * NEVER calls handlePullPose to build the expected value.
 * NEVER imports DOOR_POSE.
 */
import { describe, it, expect } from 'vitest';
import { handlePullPose } from '../handlePullMath';

describe('handlePullPose', () => {
  /**
   * Case 1 — concrete numbers from the implementation plan:
   *
   * frontTranslation = {x:300, y:560, z:400}
   * frontThickness   = 18
   * bbox             = {l:160, w:30, h:12}
   *
   * By-hand derivation:
   *   outwardFaceY  = frontTranslation.y + frontThickness/2
   *                 = 560 + 9 = 569
   *   pull.translation.x = frontTranslation.x = 300    (horizontal center)
   *   pull.translation.y = outwardFaceY + bbox.w/2
   *                      = 569 + 15 = 584              (bar proud of front face)
   *   pull.translation.z = frontTranslation.z = 400    (vertical center)
   *
   * Quaternion = identity in [x,y,z,w] order = [0,0,0,1].
   */
  it('case 1: produces correct translation and identity quaternion', () => {
    const result = handlePullPose({
      frontTranslation: { x: 300, y: 560, z: 400 },
      frontThickness: 18,
      bbox: { l: 160, w: 30, h: 12 },
    });

    // Oracle: derived independently above
    const outwardFaceY = 560 + 18 / 2; // 569
    const expectedY = outwardFaceY + 30 / 2; // 584

    expect(result.translation.x).toBeCloseTo(300, 6);
    expect(result.translation.y).toBeCloseTo(expectedY, 6);
    expect(result.translation.z).toBeCloseTo(400, 6);

    // Identity quaternion [x,y,z,w]
    expect(result.quaternion).toEqual([0, 0, 0, 1]);
  });

  /**
   * Case 2 — different numbers to rule out accidental constants:
   *
   * frontTranslation = {x:200, y:480, z:250}
   * frontThickness   = 22
   * bbox             = {l:128, w:40, h:10}
   *
   * By-hand derivation:
   *   outwardFaceY  = 480 + 22/2 = 480 + 11 = 491
   *   pull.translation.x = 200
   *   pull.translation.y = 491 + 40/2 = 491 + 20 = 511
   *   pull.translation.z = 250
   */
  it('case 2: different dimensions still produce correct standoff translation', () => {
    const result = handlePullPose({
      frontTranslation: { x: 200, y: 480, z: 250 },
      frontThickness: 22,
      bbox: { l: 128, w: 40, h: 10 },
    });

    const outwardFaceY = 480 + 22 / 2; // 491
    const expectedY = outwardFaceY + 40 / 2; // 511

    expect(result.translation.x).toBeCloseTo(200, 6);
    expect(result.translation.y).toBeCloseTo(expectedY, 6);
    expect(result.translation.z).toBeCloseTo(250, 6);

    expect(result.quaternion).toEqual([0, 0, 0, 1]);
  });

  /**
   * Standoff invariant: bar center must be PROUD of the outward face.
   * translation.y > frontTranslation.y + frontThickness/2 (i.e. standoff > 0)
   */
  it('bar is always proud of the outward front face (standoff > 0)', () => {
    const frontTranslation = { x: 300, y: 560, z: 400 };
    const frontThickness = 18;
    const bbox = { l: 160, w: 30, h: 12 };

    const result = handlePullPose({ frontTranslation, frontThickness, bbox });

    const outwardFaceY = frontTranslation.y + frontThickness / 2;
    expect(result.translation.y).toBeGreaterThan(outwardFaceY);
  });
});
