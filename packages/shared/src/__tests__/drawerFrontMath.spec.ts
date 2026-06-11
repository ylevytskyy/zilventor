import { describe, it, expect } from 'vitest';
import { drawerFrontMath } from '../drawerFrontMath';
import { DRAWER_FRONT_GAP } from '../drawerConventions';

const opening = { openBottomZ: 100, openH: 600, openW: 564, frontY: 500 };
const params = { Tc: 18, reveal: 2, insetClearance: 2 };

describe('drawerFrontMath full overlay', () => {
  it('adjacent fronts leave exactly DRAWER_FRONT_GAP, no overlap (N=3)', () => {
    const f = [0, 1, 2].map((i) => drawerFrontMath(i, 3, opening, 'full', params));
    expect(f[1]!.bottomZ - f[0]!.topZ).toBeCloseTo(DRAWER_FRONT_GAP, 6);
    expect(f[2]!.bottomZ - f[1]!.topZ).toBeCloseTo(DRAWER_FRONT_GAP, 6);
    // end fronts overhang by Tc
    expect(f[0]!.bottomZ).toBeCloseTo(100 - 18, 6);
    expect(f[2]!.topZ).toBeCloseTo(700 + 18, 6);
    // width covers sides
    expect(f[0]!.width).toBeCloseTo(564 + 2 * 18, 6);
  });

  it('verified correct expected values (N=3, openBottomZ=100, openH=600, full, Tc=18)', () => {
    // Independently-derived expected values per §14.1:
    // slotH = 600/3 = 200; overhang = 18; GAP = 3
    // f0: bottomZ = 100 + (-18) = 82;      topZ = 300 + (-1.5) = 298.5
    // f1: bottomZ = 300 + 1.5  = 301.5;    topZ = 500 + (-1.5) = 498.5
    // f2: bottomZ = 500 + 1.5  = 501.5;    topZ = 700 + 18     = 718
    const f = [0, 1, 2].map((i) => drawerFrontMath(i, 3, opening, 'full', params));
    expect(f[0]!.bottomZ).toBeCloseTo(82, 6);
    expect(f[0]!.topZ).toBeCloseTo(298.5, 6);
    expect(f[1]!.bottomZ).toBeCloseTo(301.5, 6);
    expect(f[1]!.topZ).toBeCloseTo(498.5, 6);
    expect(f[2]!.bottomZ).toBeCloseTo(501.5, 6);
    expect(f[2]!.topZ).toBeCloseTo(718, 6);
  });

  it('height matches topZ - bottomZ', () => {
    const f = [0, 1, 2].map((i) => drawerFrontMath(i, 3, opening, 'full', params));
    f.forEach((front) => {
      expect(front.height).toBeCloseTo(front.topZ - front.bottomZ, 6);
    });
  });

  it('thickness matches DRAWER_FRONT_THICKNESS (or passed param)', () => {
    const f = drawerFrontMath(0, 3, opening, 'full', params);
    expect(f.thickness).toBe(18);
  });

  it('returns correct index', () => {
    [0, 1, 2].forEach((i) => {
      const f = drawerFrontMath(i, 3, opening, 'full', params);
      expect(f.index).toBe(i);
    });
  });

  it('pose quaternion matches DOOR_POSE', () => {
    const f = drawerFrontMath(0, 3, opening, 'full', params);
    // DOOR_POSE quaternion = [0.5, 0.5, 0.5, -0.5]
    expect(f.pose.quaternion).toEqual([0.5, 0.5, 0.5, -0.5]);
  });

  it('pose translation centers front-face at frontY, center Z=(bottomZ+topZ)/2, center X=openW/2', () => {
    const f = drawerFrontMath(1, 3, opening, 'full', params);
    const expectedCenterZ = (f.bottomZ + f.topZ) / 2;
    expect(f.pose.translation.x).toBeCloseTo(opening.openW / 2, 6);
    expect(f.pose.translation.y).toBeCloseTo(opening.frontY, 6);
    expect(f.pose.translation.z).toBeCloseTo(expectedCenterZ, 6);
  });

  it('half overlay: adjacent fronts still leave exactly DRAWER_FRONT_GAP (N=2)', () => {
    const f = [0, 1].map((i) => drawerFrontMath(i, 2, opening, 'half', params));
    expect(f[1]!.bottomZ - f[0]!.topZ).toBeCloseTo(DRAWER_FRONT_GAP, 6);
    // half overhang = Tc/2 = 9
    expect(f[0]!.bottomZ).toBeCloseTo(100 - 9, 6);
    expect(f[1]!.topZ).toBeCloseTo(700 + 9, 6);
    expect(f[0]!.width).toBeCloseTo(564 + 2 * 9, 6);
  });

  it('N=1 full: no inner boundaries, both ends overhang', () => {
    const f = drawerFrontMath(0, 1, opening, 'full', params);
    expect(f.bottomZ).toBeCloseTo(100 - 18, 6);
    expect(f.topZ).toBeCloseTo(700 + 18, 6);
  });
});

describe('drawerFrontMath inset', () => {
  it('front sits inside slot with clearance, no overlap', () => {
    const f0 = drawerFrontMath(0, 3, opening, 'inset', params);
    expect(f0.bottomZ).toBeCloseTo(100 + 2, 6);
    expect(f0.width).toBeCloseTo(564 - 4, 6);
  });

  it('all inset fronts have no overlap (N=3)', () => {
    const f = [0, 1, 2].map((i) => drawerFrontMath(i, 3, opening, 'inset', params));
    // each front is inside its own slot with clearance on each side
    // no overlap: adjacent topZ_i < bottomZ_{i+1}
    expect(f[1]!.bottomZ).toBeGreaterThan(f[0]!.topZ);
    expect(f[2]!.bottomZ).toBeGreaterThan(f[1]!.topZ);
  });

  it('inset top and bottom respect clearance', () => {
    const c = params.insetClearance;
    const f = [0, 1, 2].map((i) => drawerFrontMath(i, 3, opening, 'inset', params));
    const slotH = opening.openH / 3;
    f.forEach((front, i) => {
      const slotBottomZ = opening.openBottomZ + i * slotH;
      const slotTopZ = opening.openBottomZ + (i + 1) * slotH;
      expect(front.bottomZ).toBeCloseTo(slotBottomZ + c, 6);
      expect(front.topZ).toBeCloseTo(slotTopZ - c, 6);
    });
  });
});
