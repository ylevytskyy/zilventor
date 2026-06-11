import { describe, expect, it } from 'vitest';
import type { ComponentColor } from '@zilventor/shared';
import { effectiveColorToRgb } from '../resolveExportLeaves';

const hex = (h: string): ComponentColor => ({ kind: 'hex', hex: h });
const pal = (name: string): ComponentColor => ({ kind: 'palette', name });

describe('effectiveColorToRgb', () => {
  it('maps a hex color to 0–1 RGB', () => {
    expect(effectiveColorToRgb(hex('#ff8000'), {})).toEqual([255 / 255, 128 / 255, 0 / 255]);
  });

  it('maps a palette hit via assembly.colors', () => {
    expect(effectiveColorToRgb(pal('oak'), { oak: '#00ff00' })).toEqual([0, 1, 0]);
  });

  it('returns undefined for a palette miss (name not in colors)', () => {
    expect(effectiveColorToRgb(pal('walnut'), { oak: '#00ff00' })).toBeUndefined();
  });

  it('returns undefined for an undefined color', () => {
    expect(effectiveColorToRgb(undefined, { oak: '#00ff00' })).toBeUndefined();
  });

  it('accepts hex without leading # and 3-component values', () => {
    expect(effectiveColorToRgb(hex('0080ff'), {})).toEqual([0, 128 / 255, 1]);
  });
});
