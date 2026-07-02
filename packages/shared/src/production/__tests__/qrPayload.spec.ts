import { describe, it, expect } from 'vitest';
import { parseQrPayload, producedPanelKey } from '../qrPayload';

describe('parseQrPayload', () => {
  it('parses a valid payload into all 7 fields', () => {
    const payload = 'Z|3|1/4|600x400x18|ЛДСП 18мм';
    expect(parseQrPayload(payload)).toEqual({
      itemNumber: 3,
      copyIndex: 1,
      qty: 4,
      length: 600,
      width: 400,
      thickness: 18,
      materialName: 'ЛДСП 18мм',
    });
  });

  it('parses decimal dimensions', () => {
    const payload = 'Z|7|2/2|600.5x400.25x18|Oak';
    expect(parseQrPayload(payload)).toEqual({
      itemNumber: 7,
      copyIndex: 2,
      qty: 2,
      length: 600.5,
      width: 400.25,
      thickness: 18,
      materialName: 'Oak',
    });
  });

  it('returns null for an empty string', () => {
    expect(parseQrPayload('')).toBeNull();
  });

  it('returns null for foreign QR text', () => {
    expect(parseQrPayload('https://example.com/some-other-code')).toBeNull();
  });

  it('returns null for the wrong field count', () => {
    expect(parseQrPayload('Z|3|1/4|600x400x18')).toBeNull();
  });

  it('returns null for non-numeric dims, without throwing', () => {
    expect(() => parseQrPayload('Z|3|1/4|abcxdefxghi|Oak')).not.toThrow();
    expect(parseQrPayload('Z|3|1/4|abcxdefxghi|Oak')).toBeNull();
  });

  it('round-trips against the exact buildPanelLabels encoder template', () => {
    const row = { itemNumber: 12, length: 715.5, width: 496, thickness: 18, materialName: 'ЛДСП 18мм' };
    const k = 3;
    const qty = 5;
    const payload = `Z|${row.itemNumber}|${k}/${qty}|${row.length}x${row.width}x${row.thickness}|${row.materialName}`;
    expect(parseQrPayload(payload)).toEqual({
      itemNumber: row.itemNumber,
      copyIndex: k,
      qty,
      length: row.length,
      width: row.width,
      thickness: row.thickness,
      materialName: row.materialName,
    });
  });
});

describe('producedPanelKey', () => {
  it('formats itemNumber:copyIndex', () => {
    expect(producedPanelKey(3, 1)).toBe('3:1');
  });
});
