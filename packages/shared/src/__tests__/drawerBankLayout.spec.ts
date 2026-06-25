import { describe, it, expect } from 'vitest';
import { drawerBankLayout } from '../drawerBankLayout';

describe('drawerBankLayout', () => {
  it('tiles the opening into N equal slots with no gap/overlap (N=3, openH=500)', () => {
    const openBottomZ = 100;
    const slots = drawerBankLayout({ openBottomZ, openH: 500 }, 3);
    expect(slots).toHaveLength(3);
    expect(slots[0]!.bottomZ).toBeCloseTo(100, 6);
    expect(slots[1]!.bottomZ).toBeCloseTo(slots[0]!.topZ, 6);
    expect(slots[2]!.bottomZ).toBeCloseTo(slots[1]!.topZ, 6);
    expect(slots[2]!.topZ).toBeCloseTo(600, 6);
    slots.forEach((s) => expect(s.topZ - s.bottomZ).toBeCloseTo(500 / 3, 6));
  });
});

describe('drawerBankLayout — explicit heights', () => {
  it('tiles non-uniform heights from cumulative offsets (no gap/overlap)', () => {
    const openBottomZ = 100;
    const slots = drawerBankLayout({ openBottomZ, openH: 600 }, 3, [100, 200, 300]);
    expect(slots).toHaveLength(3);
    expect(slots[0]!.bottomZ).toBeCloseTo(100, 6);
    expect(slots[0]!.topZ).toBeCloseTo(200, 6);
    expect(slots[1]!.bottomZ).toBeCloseTo(slots[0]!.topZ, 6); // 200
    expect(slots[1]!.topZ).toBeCloseTo(400, 6);
    expect(slots[2]!.bottomZ).toBeCloseTo(slots[1]!.topZ, 6); // 400
    expect(slots[2]!.topZ).toBeCloseTo(700, 6);
    // each slot height matches its requested value
    expect(slots[0]!.topZ - slots[0]!.bottomZ).toBeCloseTo(100, 6);
    expect(slots[1]!.topZ - slots[1]!.bottomZ).toBeCloseTo(200, 6);
    expect(slots[2]!.topZ - slots[2]!.bottomZ).toBeCloseTo(300, 6);
  });

  it('throws heightSum when heights do not sum to openH (> 0.5mm)', () => {
    expect(() => drawerBankLayout({ openBottomZ: 100, openH: 600 }, 3, [100, 200, 290]))
      .toThrow(/drawerBank\.error\.heightSum/);
  });

  it('accepts heights within ±0.5mm of openH', () => {
    expect(() => drawerBankLayout({ openBottomZ: 100, openH: 600 }, 3, [100, 200, 300.4]))
      .not.toThrow();
  });

  it('throws heightCount when heights.length !== n', () => {
    expect(() => drawerBankLayout({ openBottomZ: 100, openH: 600 }, 3, [300, 300]))
      .toThrow(/drawerBank\.error\.heightCount/);
  });

  it('omitting heights yields the uniform split (regression)', () => {
    const a = drawerBankLayout({ openBottomZ: 100, openH: 600 }, 3);
    const b = drawerBankLayout({ openBottomZ: 100, openH: 600 }, 3, [200, 200, 200]);
    a.forEach((s, i) => {
      expect(s.bottomZ).toBeCloseTo(b[i]!.bottomZ, 6);
      expect(s.topZ).toBeCloseTo(b[i]!.topZ, 6);
    });
  });
});
