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
