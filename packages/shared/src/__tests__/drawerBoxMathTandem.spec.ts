import { describe, it, expect } from 'vitest';
import { drawerBoxMath } from '../drawerBoxMath';
import { SLIDE_CLEARANCE_PER_SIDE } from '../drawerConventions';
import { TANDEM_SLIDE_CLEARANCE_PER_SIDE } from '../tandemConventions';

const slot = { bottomZ: 100, topZ: 300 };
const openW = 600;
const innerD = 560;

describe('drawerBoxMath — slideSystem', () => {
  it('slideSystem=sideMount (default): box width = openW − 2 × 12.5', () => {
    const r = drawerBoxMath(slot, { openW, innerD });
    expect(r.outer.width).toBeCloseTo(openW - 2 * SLIDE_CLEARANCE_PER_SIDE, 6); // 575
  });

  it('slideSystem=sideMount explicit: same as default', () => {
    const r = drawerBoxMath(slot, { openW, innerD, slideSystem: 'sideMount' });
    expect(r.outer.width).toBeCloseTo(openW - 2 * SLIDE_CLEARANCE_PER_SIDE, 6);
  });

  it('slideSystem=tandem: box width = openW − 2 × 21 = 558', () => {
    const r = drawerBoxMath(slot, { openW, innerD, slideSystem: 'tandem' });
    expect(r.outer.width).toBeCloseTo(openW - 2 * TANDEM_SLIDE_CLEARANCE_PER_SIDE, 6); // 558
  });

  it('slideSystem=tandem: height, depth, panels unchanged from side-mount', () => {
    const def = drawerBoxMath(slot, { openW, innerD });
    const tan = drawerBoxMath(slot, { openW, innerD, slideSystem: 'tandem' });
    expect(tan.outer.height).toBeCloseTo(def.outer.height, 6);
    expect(tan.outer.depth).toBeCloseTo(def.outer.depth, 6);
    expect(tan.panels).toHaveLength(def.panels.length);
  });
});
