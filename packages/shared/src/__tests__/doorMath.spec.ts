import { describe, it, expect } from 'vitest';
import { doorMath, type DoorMathInput } from '../doorMath';
import { DOOR_POSE } from '../prisadkaFaceConventions';

// Real base-cabinet external dims (typical full-height carcass), Tc from the
// carcass material default thickness. These mirror buildBaseCabinet's inputs so
// the door sizing is checked against the SAME numbers the carcass uses.
const CABINET = { width: 600, height: 720, depth: 560, Tc: 18, toekickHeight: 100 };

function baseInput(over: Partial<DoorMathInput> = {}): DoorMathInput {
  return {
    cabinet: CABINET,
    count: 'single',
    overlay: 'full',
    hingeSide: 'left',
    thickness: 18,
    reveal: 2,
    clearance: 2,
    centerReveal: 3,
    ...over,
  };
}

describe('doorMath — sizing', () => {
  it('single full-overlay door = W−2r × H−2r, thickness Td', () => {
    const doors = doorMath(baseInput({ overlay: 'full', count: 'single' }));
    expect(doors).toHaveLength(1);
    const d = doors[0]!;
    expect(d.dims.width).toBeCloseTo(600 - 2 * 2, 6);   // doorW = W − 2r
    expect(d.dims.length).toBeCloseTo(720 - 2 * 2, 6);  // doorH = H − 2r  (length→localX)
    expect(d.dims.thickness).toBeCloseTo(18, 6);        // Td (thickness→localZ)
  });

  it('half-overlay sizing matches full (differs only in cup setback, not geometry)', () => {
    const full = doorMath(baseInput({ overlay: 'full' }))[0]!;
    const half = doorMath(baseInput({ overlay: 'half' }))[0]!;
    expect(half.dims.width).toBeCloseTo(full.dims.width, 6);
    expect(half.dims.length).toBeCloseTo(full.dims.length, 6);
  });

  it('single inset door = (Wo−2c) × (innerOpeningH−2c), Wo=W−2Tc, innerH=H−tkH−2Tc', () => {
    const doors = doorMath(baseInput({ overlay: 'inset', count: 'single' }));
    const d = doors[0]!;
    const Wo = 600 - 2 * 18;                  // = 564
    const innerH = 720 - 100 - 2 * 18;        // = 584
    expect(d.dims.width).toBeCloseTo(Wo - 2 * 2, 6);     // 560
    expect(d.dims.length).toBeCloseTo(innerH - 2 * 2, 6); // 580
  });

  it('double full-overlay: two doors, each (W−2r−cr)/2 wide, same height', () => {
    const doors = doorMath(baseInput({ count: 'double', overlay: 'full' }));
    expect(doors).toHaveLength(2);
    const each = (600 - 2 * 2 - 3) / 2;       // (W − 2r − cr)/2
    expect(doors[0]!.dims.width).toBeCloseTo(each, 6);
    expect(doors[1]!.dims.width).toBeCloseTo(each, 6);
    expect(doors[0]!.dims.length).toBeCloseTo(720 - 2 * 2, 6);
    expect(doors[1]!.dims.length).toBeCloseTo(doors[0]!.dims.length, 6);
  });

  it('double inset: each (Wo−cr−2c)/2 wide, inset height', () => {
    const doors = doorMath(baseInput({ count: 'double', overlay: 'inset' }));
    expect(doors).toHaveLength(2);
    const Wo = 600 - 2 * 18;                  // 564
    const each = (Wo - 3 - 2 * 2) / 2;        // (Wo − cr − 2c)/2  → split with center clearance
    expect(doors[0]!.dims.width).toBeCloseTo(each, 6);
    expect(doors[1]!.dims.width).toBeCloseTo(each, 6);
  });
});

describe('doorMath — doorSpec', () => {
  it('single carries the dialog hingeSide + pair:single + auto hingeCount', () => {
    const doors = doorMath(baseInput({ count: 'single', hingeSide: 'right' }));
    const d = doors[0]!;
    expect(d.doorSpec.pair).toBe('single');
    expect(d.doorSpec.hingeSide).toBe('right');
    expect(d.doorSpec.overlay).toBe('full');
    expect(d.doorSpec.hingeCount).toBeGreaterThanOrEqual(2); // resolved from doorH
  });

  it('double: left door pairLeft/hinge left, right door pairRight/hinge right', () => {
    const doors = doorMath(baseInput({ count: 'double' }));
    const left = doors[0]!;
    const right = doors[1]!;
    expect(left.doorSpec.pair).toBe('pairLeft');
    expect(left.doorSpec.hingeSide).toBe('left');
    expect(right.doorSpec.pair).toBe('pairRight');
    expect(right.doorSpec.hingeSide).toBe('right');
  });

  it('both doors of a pair get the same auto hingeCount', () => {
    const doors = doorMath(baseInput({ count: 'double' }));
    expect(doors[0]!.doorSpec.hingeCount).toBe(doors[1]!.doorSpec.hingeCount);
  });
});

describe('doorMath — pose', () => {
  it('every door has a pose with a translation + a 4-tuple quaternion matching DOOR_POSE', () => {
    for (const d of doorMath(baseInput({ count: 'double' }))) {
      expect(typeof d.pose.translation.x).toBe('number');
      expect(typeof d.pose.translation.y).toBe('number');
      expect(typeof d.pose.translation.z).toBe('number');
      expect(d.pose.quaternion).toHaveLength(4);
      // quaternion must be the Phase-0-derived upright pose, not a local re-declaration
      expect(d.pose.quaternion).toEqual(DOOR_POSE.quaternion);
    }
  });

  it('double doors are offset from each other in the cabinet-width direction', () => {
    const doors = doorMath(baseInput({ count: 'double' }));
    const left = doors[0]!;
    const right = doors[1]!;
    // The two leaves cannot share the same world translation.
    const same =
      left.pose.translation.x === right.pose.translation.x &&
      left.pose.translation.y === right.pose.translation.y &&
      left.pose.translation.z === right.pose.translation.z;
    expect(same).toBe(false);
  });
});

describe('doorMath — openingWidth + openingXOffset (blind corner)', () => {
  it('openingWidth sizes door to opening, not cabinet width', () => {
    const result = doorMath({
      cabinet: { width: 900, height: 720, depth: 560, Tc: 18, toekickHeight: 100 },
      count: 'single', overlay: 'full', hingeSide: 'left',
      thickness: 18, reveal: 2, clearance: 2, centerReveal: 3,
      openingWidth: 450,
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.dims.width).toBeCloseTo(446, 1);   // 450 - 2*2
    expect(result[0]!.dims.length).toBeCloseTo(716, 1);  // 720 - 2*2
  });

  it('openingXOffset shifts door center X', () => {
    const result = doorMath({
      cabinet: { width: 900, height: 720, depth: 560, Tc: 18, toekickHeight: 100 },
      count: 'single', overlay: 'full', hingeSide: 'right',
      thickness: 18, reveal: 2, clearance: 2, centerReveal: 3,
      openingWidth: 450, openingXOffset: 450,
    });
    expect(result[0]!.pose.translation.x).toBeCloseTo(450 + 223, 1); // xOffset + doorW/2
  });

  it('legacy call without new fields produces unchanged output', () => {
    const result = doorMath({
      cabinet: { width: 600, height: 720, depth: 560, Tc: 18, toekickHeight: 100 },
      count: 'single', overlay: 'full', hingeSide: 'left',
      thickness: 18, reveal: 2, clearance: 2, centerReveal: 3,
    });
    expect(result[0]!.dims.width).toBeCloseTo(596, 1);        // 600 - 2*2
    expect(result[0]!.pose.translation.x).toBeCloseTo(300, 1); // 600/2
  });
});
