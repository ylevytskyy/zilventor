import { describe, it, expect } from 'vitest';
import { aciToRgb } from '../aci';

describe('aciToRgb', () => {
  it('maps the standard base colors 1-9', () => {
    expect(aciToRgb(1)).toBe(0xff0000); // red
    expect(aciToRgb(2)).toBe(0xffff00); // yellow
    expect(aciToRgb(3)).toBe(0x00ff00); // green
    expect(aciToRgb(4)).toBe(0x00ffff); // cyan
    expect(aciToRgb(5)).toBe(0x0000ff); // blue
    expect(aciToRgb(6)).toBe(0xff00ff); // magenta
    expect(aciToRgb(8)).toBe(0x808080);
    expect(aciToRgb(9)).toBe(0xc0c0c0);
  });

  it('returns undefined for foreground/by-layer/by-block and unmapped', () => {
    expect(aciToRgb(0)).toBeUndefined();   // BYBLOCK
    expect(aciToRgb(7)).toBeUndefined();   // white/foreground -> native default
    expect(aciToRgb(256)).toBeUndefined(); // BYLAYER
    expect(aciToRgb(123)).toBeUndefined(); // unmapped extended index
  });

  it('maps the common extended + gray ramp', () => {
    expect(aciToRgb(30)).toBe(0xff7f00);
    expect(aciToRgb(250)).toBe(0x333333);
    expect(aciToRgb(255)).toBe(0xb3b3b3);
  });
});
