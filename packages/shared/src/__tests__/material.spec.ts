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

  it('accepts an optional bandThicknessMm', () => {
    const entry: MaterialEntry = {
      id: 'm-pvc', name: 'PVC tape', defaultThickness: 18, color: '#ffffff', bandThicknessMm: 0.4,
    };
    expect(isMaterialEntry(entry)).toBe(true);
  });

  it('rejects a non-positive bandThicknessMm', () => {
    const entry = { id: 'm1', name: 'X', defaultThickness: 18, color: '#000000', bandThicknessMm: 0 };
    expect(isMaterialEntry(entry)).toBe(false);
  });
});

describe('isMaterialEntry — sheet-stock fields', () => {
  const base = { id: 'm1', name: 'Birch', defaultThickness: 18, color: '#aabbcc' };

  it('accepts entry without sheet-stock fields (legacy)', () => {
    expect(isMaterialEntry(base)).toBe(true);
  });

  it('accepts entry with both sheetLengthMm and sheetWidthMm > 0', () => {
    expect(isMaterialEntry({ ...base, sheetLengthMm: 2440, sheetWidthMm: 1220 })).toBe(true);
  });

  it('rejects entry with only sheetLengthMm set', () => {
    expect(isMaterialEntry({ ...base, sheetLengthMm: 2440 })).toBe(false);
  });

  it('rejects entry with only sheetWidthMm set', () => {
    expect(isMaterialEntry({ ...base, sheetWidthMm: 1220 })).toBe(false);
  });

  it('rejects entry with sheetLengthMm <= 0', () => {
    expect(isMaterialEntry({ ...base, sheetLengthMm: 0, sheetWidthMm: 1220 })).toBe(false);
    expect(isMaterialEntry({ ...base, sheetLengthMm: -1, sheetWidthMm: 1220 })).toBe(false);
  });

  it('rejects entry with non-finite sheet dims', () => {
    expect(isMaterialEntry({ ...base, sheetLengthMm: NaN, sheetWidthMm: 1220 })).toBe(false);
    expect(isMaterialEntry({ ...base, sheetLengthMm: Infinity, sheetWidthMm: 1220 })).toBe(false);
  });
});

describe('isMaterialEntry — kind field', () => {
  const base = { id: 'm1', name: 'Oak', defaultThickness: 18, color: '#8b6914' };

  it('accepts entry without kind (absent === sheet)', () => {
    expect(isMaterialEntry(base)).toBe(true);
  });

  it('accepts entry with kind: "sheet"', () => {
    expect(isMaterialEntry({ ...base, kind: 'sheet' })).toBe(true);
  });

  it('accepts entry with kind: "linear"', () => {
    expect(isMaterialEntry({ ...base, kind: 'linear' })).toBe(true);
  });

  it('rejects entry with an invalid kind value', () => {
    expect(isMaterialEntry({ ...base, kind: 'invalid-value' })).toBe(false);
  });
});

describe('isMaterialEntry — textureId field', () => {
  const base = { id: 'm1', name: 'Oak', defaultThickness: 18, color: '#8b6914' };

  it('accepts entry without textureId (field absent)', () => {
    expect(isMaterialEntry(base)).toBe(true);
  });

  it('accepts entry with a non-empty string textureId', () => {
    expect(isMaterialEntry({ ...base, textureId: 'oak' })).toBe(true);
  });

  it('rejects entry with empty string textureId', () => {
    expect(isMaterialEntry({ ...base, textureId: '' })).toBe(false);
  });

  it('rejects entry with non-string textureId', () => {
    expect(isMaterialEntry({ ...base, textureId: 42 })).toBe(false);
  });
});
