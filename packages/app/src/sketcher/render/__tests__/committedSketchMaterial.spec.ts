import { describe, it, expect } from 'vitest';
import { materialSpec } from '../CommittedSketchRenderer';
import type { SketchPrimitive } from '@zilventor/shared';

const line = (extra: Partial<SketchPrimitive>): SketchPrimitive =>
  ({ id: 'x', kind: 'line', x1: 0, y1: 0, x2: 1, y2: 0, ...extra } as SketchPrimitive);

describe('materialSpec', () => {
  it('plain primitive -> default colour, solid', () => {
    expect(materialSpec(line({}))).toEqual({ color: 0xe8e8e8, dashed: false, dashSize: 0, gapSize: 0 });
  });
  it('imported colour -> that colour, solid', () => {
    expect(materialSpec(line({ color: 0xff0000 }))).toMatchObject({ color: 0xff0000, dashed: false });
  });
  it('lineStyle dashed -> dashed material in the imported colour', () => {
    expect(materialSpec(line({ color: 0x0000ff, lineStyle: 'dashed' }))).toMatchObject({ color: 0x0000ff, dashed: true });
  });
  it('construction wins: gray dashed regardless of imported colour', () => {
    expect(materialSpec(line({ construction: true, color: 0xff0000, lineStyle: 'dashdot' })))
      .toMatchObject({ color: 0x8a8f98, dashed: true, dashSize: 2, gapSize: 1.5 });
  });
});
