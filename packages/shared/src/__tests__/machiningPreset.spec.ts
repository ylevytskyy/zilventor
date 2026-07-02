import { describe, it, expect } from 'vitest';
import type { MachiningPreset } from '../machiningPreset';

describe('machiningPreset.ts — MachiningPreset shape', () => {
  it('accepts a bore-role opType preset with only required fields', () => {
    const p: MachiningPreset = {
      id: 'preset-1',
      name: 'Confirmat face bore',
      opType: 'confirmat-face',
      diameter: 8,
      depth: 13,
      layerName: 'CONFIRMAT',
    };
    expect(p.opType).toBe('confirmat-face');
    expect('offset' in p).toBe(false);
    expect('toolNumber' in p).toBe(false);
    expect('speed' in p).toBe(false);
  });

  it("accepts opType: 'groove' alongside BoreRole members", () => {
    const p: MachiningPreset = {
      id: 'preset-2',
      name: 'Back panel groove',
      opType: 'groove',
      diameter: 6,
      depth: 8,
      layerName: 'GROOVE',
    };
    expect(p.opType).toBe('groove');
  });

  it('accepts optional offset/toolNumber/speed when explicitly set', () => {
    const p: MachiningPreset = {
      id: 'preset-3',
      name: 'Shelf pin',
      opType: 'shelfPin-system32',
      diameter: 5,
      depth: 13,
      offset: 37,
      layerName: 'SHELFPIN',
      toolNumber: 4,
      speed: 3000,
    };
    expect(p.offset).toBe(37);
    expect(p.toolNumber).toBe(4);
    expect(p.speed).toBe(3000);
  });
});
