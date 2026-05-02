import { describe, expect, it } from 'vitest';
import { isMaterialEntry, type MaterialEntry, type MaterialRegistry } from '../material';

describe('isMaterialEntry', () => {
  it('accepts a well-formed entry', () => {
    const entry: MaterialEntry = {
      id: '01HX0000000000000000000001',
      name: 'Birch Plywood 18mm',
      defaultThickness: 18,
      color: '#d8c896',
    };
    expect(isMaterialEntry(entry)).toBe(true);
  });

  it('rejects negative defaultThickness', () => {
    const entry = { id: 'm1', name: 'X', defaultThickness: -1, color: '#000' };
    expect(isMaterialEntry(entry)).toBe(false);
  });

  it('rejects empty name', () => {
    const entry = { id: 'm1', name: '', defaultThickness: 18, color: '#000' };
    expect(isMaterialEntry(entry)).toBe(false);
  });

  it('rejects non-hex color', () => {
    const entry = { id: 'm1', name: 'X', defaultThickness: 18, color: 'red' };
    expect(isMaterialEntry(entry)).toBe(false);
  });

  it('typed registry is an array of entries', () => {
    const reg: MaterialRegistry = [];
    expect(Array.isArray(reg)).toBe(true);
  });
});
