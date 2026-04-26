import { describe, it, expect } from 'vitest';
import { bomRowKey } from '../bomRow';

describe('bomRowKey', () => {
  it('returns ::none for missing color', () => {
    expect(bomRowKey('parts/cube.zipt')).toBe('parts/cube.zipt::none');
    expect(bomRowKey('parts/cube.zipt', undefined)).toBe('parts/cube.zipt::none');
  });

  it('encodes palette colors with name', () => {
    expect(bomRowKey('parts/cube.zipt', { kind: 'palette', name: 'Maple' }))
      .toBe('parts/cube.zipt::palette:Maple');
  });

  it('encodes hex colors normalised to lowercase', () => {
    expect(bomRowKey('parts/cube.zipt', { kind: 'hex', hex: '#CC8866' }))
      .toBe('parts/cube.zipt::hex:#cc8866');
  });

  it('does not collide across kinds with the same string after the prefix', () => {
    const a = bomRowKey('parts/cube.zipt', { kind: 'palette', name: '#Maple' });
    const b = bomRowKey('parts/cube.zipt', { kind: 'hex', hex: '#Maple' });
    expect(a).not.toBe(b);
  });
});
