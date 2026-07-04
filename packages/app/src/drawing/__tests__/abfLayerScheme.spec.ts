import { describe, it, expect } from 'vitest';
import { abfBoreLayer, ABF_OUTLINE_LAYER } from '../abfLayerScheme';
import type { BoreOp } from '@zilventor/shared';

function bore(over: Partial<BoreOp> = {}): BoreOp {
  const face: BoreOp['face'] = { featureId: 'panel', role: 'Top', instance: 0 };
  return {
    id: 'b1', face, u: 0, v: 0, diameter: 8, depth: 13,
    role: 'shelfPin-system32', connectorId: 'c1', connectorKind: 'shelfPin',
    ...over,
  } as BoreOp;
}

describe('abfBoreLayer', () => {
  it('face bore with sku → DEPTH<depth>-ARTICLE<sku>', () => {
    expect(abfBoreLayer(bore({ depth: 13, sku: 'hinge-35mm-cup-full' }), 'face'))
      .toBe('DEPTH13-ARTICLEhinge-35mm-cup-full');
  });

  it('face bore without sku → bare DEPTH<depth>', () => {
    expect(abfBoreLayer(bore({ depth: 13 }), 'face')).toBe('DEPTH13');
  });

  it('face bore with decimal depth → DEPTH13.8', () => {
    expect(abfBoreLayer(bore({ depth: 13.8 }), 'face')).toBe('DEPTH13.8');
  });

  it('edge bore → ABF-DSIDE-<dia> (integer diameter)', () => {
    expect(abfBoreLayer(bore({ diameter: 8, depth: 12 }), 'edge')).toBe('ABF-DSIDE-8');
  });

  it('edge bore → ABF-DSIDE-<dia> (decimal diameter)', () => {
    expect(abfBoreLayer(bore({ diameter: 4.5, depth: 12 }), 'edge')).toBe('ABF-DSIDE-4.5');
  });

  it('edge bore ignores sku', () => {
    expect(abfBoreLayer(bore({ diameter: 8, depth: 12, sku: 'some-sku' }), 'edge'))
      .toBe('ABF-DSIDE-8');
  });

  it('throughAll bore → null (caller falls back to native scheme)', () => {
    expect(abfBoreLayer(bore({ depth: 'throughAll' }), 'face')).toBeNull();
    expect(abfBoreLayer(bore({ depth: 'throughAll' }), 'edge')).toBeNull();
  });

  it('whole-number depth formats without trailing .0 (8.0 → "8")', () => {
    expect(abfBoreLayer(bore({ depth: 8.0 }), 'face')).toBe('DEPTH8');
  });
});

describe('ABF_OUTLINE_LAYER', () => {
  it('is the ABF cutting-lines layer name', () => {
    expect(ABF_OUTLINE_LAYER).toBe('ABF_cuttingLines');
  });
});
