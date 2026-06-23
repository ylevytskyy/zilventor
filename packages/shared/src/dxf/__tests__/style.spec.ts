import { describe, it, expect } from 'vitest';
import { resolveStyle, linetypeToStyle } from '../style';
import type { DxfLayer } from '../types';

const layers: Record<string, DxfLayer> = {
  walls: { name: 'walls', color: 1, linetype: 'CONTINUOUS', flags: 0 },
  hidden: { name: 'hidden', color: 5, linetype: 'HIDDEN', flags: 0 },
  centre: { name: 'centre', color: 3, linetype: 'CENTER', flags: 0 },
};

describe('linetypeToStyle', () => {
  it('maps families and treats unknown/continuous as solid', () => {
    expect(linetypeToStyle('CONTINUOUS')).toBeUndefined();
    expect(linetypeToStyle('')).toBeUndefined();
    expect(linetypeToStyle('DASHED')).toBe('dashed');
    expect(linetypeToStyle('HIDDEN')).toBe('dashed');
    expect(linetypeToStyle('CENTER')).toBe('dashdot');
    expect(linetypeToStyle('PHANTOM')).toBe('dashdot');
    expect(linetypeToStyle('WEIRD_LT')).toBeUndefined();
  });
});

describe('resolveStyle', () => {
  it('uses layer color/linetype when entity is BYLAYER (absent codes)', () => {
    expect(resolveStyle({ layer: 'walls' }, layers)).toEqual({ color: 0xff0000 });
    expect(resolveStyle({ layer: 'hidden' }, layers)).toEqual({ color: 0x0000ff, lineStyle: 'dashed' });
    expect(resolveStyle({ layer: 'centre' }, layers)).toEqual({ color: 0x00ff00, lineStyle: 'dashdot' });
  });

  it('entity-level color/linetype overrides the layer', () => {
    expect(resolveStyle({ layer: 'walls', color: 5, linetype: 'CENTER' }, layers))
      .toEqual({ color: 0x0000ff, lineStyle: 'dashdot' });
  });

  it('entity color 256 = BYLAYER falls back to layer color', () => {
    expect(resolveStyle({ layer: 'walls', color: 256 }, layers)).toEqual({ color: 0xff0000 });
  });

  it('entity color 0 = BYBLOCK resolves to native default (no color field)', () => {
    expect(resolveStyle({ layer: 'walls', color: 0 }, layers)).toEqual({});
  });

  it('entity linetype BYLAYER falls back to the layer linetype', () => {
    expect(resolveStyle({ layer: 'hidden', linetype: 'BYLAYER' }, layers))
      .toEqual({ color: 0x0000ff, lineStyle: 'dashed' });
  });

  it('unknown layer -> empty style', () => {
    expect(resolveStyle({ layer: 'nope' }, layers)).toEqual({});
  });
});
