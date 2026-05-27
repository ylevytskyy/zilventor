import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildDxfZip } from '../dxfZip';

describe('buildDxfZip', () => {
  it('ZIP-1: round-trips entries — each DXF string recovered byte-exact under its name', () => {
    const entries = { '01-Sheet 1.dxf': 'DXF-A\nLINE', '02-Sheet 2.dxf': 'DXF-B' };
    const zip = buildDxfZip(entries);
    expect(zip).toBeInstanceOf(Uint8Array);
    expect(zip.length).toBeGreaterThan(0);
    const back = unzipSync(zip);
    expect(Object.keys(back).sort()).toEqual(['01-Sheet 1.dxf', '02-Sheet 2.dxf']);
    expect(strFromU8(back['01-Sheet 1.dxf']!)).toBe('DXF-A\nLINE');
    expect(strFromU8(back['02-Sheet 2.dxf']!)).toBe('DXF-B');
  });

  it('ZIP-2: empty input yields a valid (empty) zip', () => {
    const zip = buildDxfZip({});
    expect(zip).toBeInstanceOf(Uint8Array);
    expect(Object.keys(unzipSync(zip))).toEqual([]);
  });
});
