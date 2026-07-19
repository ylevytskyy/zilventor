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

  // ABF-DSIDE-<dia> was live-disqualified 2026-07-19: viyar.pro never reads depth from the
  // circle+companion-polyline pair, so a finite-depth edge bore now shares the SAME
  // DEPTH<depth>[-ARTICLE<sku>] family as a face bore — orientation no longer branches this case.
  it('edge bore with finite depth → DEPTH<depth>, same as a face bore (no ABF-DSIDE)', () => {
    expect(abfBoreLayer(bore({ diameter: 8, depth: 12 }), 'edge')).toBe('DEPTH12');
  });

  it('edge bore with finite depth and decimal diameter → DEPTH<depth> (diameter plays no role in the name)', () => {
    expect(abfBoreLayer(bore({ diameter: 4.5, depth: 12 }), 'edge')).toBe('DEPTH12');
  });

  it('edge bore WITH sku → DEPTH<depth>-ARTICLE<sku>, same as a face bore (sku no longer ignored)', () => {
    expect(abfBoreLayer(bore({ diameter: 8, depth: 12, sku: 'some-sku' }), 'edge'))
      .toBe('DEPTH12-ARTICLEsome-sku');
  });

  it('throughAll bore without sku → null (caller falls back to native scheme)', () => {
    expect(abfBoreLayer(bore({ depth: 'throughAll' }), 'face')).toBeNull();
    expect(abfBoreLayer(bore({ depth: 'throughAll' }), 'edge')).toBeNull();
  });

  it('throughAll bore WITH sku → D<diameter>-DEPTHF-<sku> (ViyarPro flatten DEPTHF convention), regardless of orientation', () => {
    expect(abfBoreLayer(bore({ diameter: 7, depth: 'throughAll', sku: '$44817' }), 'face'))
      .toBe('D7-DEPTHF-$44817');
    expect(abfBoreLayer(bore({ diameter: 7, depth: 'throughAll', sku: '$44817' }), 'edge'))
      .toBe('D7-DEPTHF-$44817');
  });

  it('throughAll bore with empty-string sku still → null (no bare DEPTHF form, unlike DEPTH<depth>)', () => {
    expect(abfBoreLayer(bore({ depth: 'throughAll', sku: '' }), 'face')).toBeNull();
  });

  it('throughAll bore sku is transliterated/sanitized the same as face-bore sku', () => {
    expect(abfBoreLayer(bore({ diameter: 5, depth: 'throughAll', sku: 'Петля' }), 'face'))
      .toBe('D5-DEPTHF-Petlya');
  });

  it('whole-number depth formats without trailing .0 (8.0 → "8")', () => {
    expect(abfBoreLayer(bore({ depth: 8.0 }), 'face')).toBe('DEPTH8');
  });

  it('Cyrillic sku is transliterated for DXF-ASCII safety', () => {
    expect(abfBoreLayer(bore({ depth: 13, sku: 'Петля' }), 'face'))
      .toBe('DEPTH13-ARTICLEPetlya');
  });

  it('$-prefixed sku passes through unchanged (real ABF SKUs are $-prefixed)', () => {
    expect(abfBoreLayer(bore({ depth: 13, sku: '$12345' }), 'face'))
      .toBe('DEPTH13-ARTICLE$12345');
  });

  it('spaces and punctuation in sku collapse to a single underscore', () => {
    expect(abfBoreLayer(bore({ depth: 13, sku: 'hinge 35mm, cup/full!' }), 'face'))
      .toBe('DEPTH13-ARTICLEhinge_35mm_cup_full');
  });

  it('empty sku keeps current behavior (no -ARTICLE suffix)', () => {
    expect(abfBoreLayer(bore({ depth: 13, sku: '' }), 'face')).toBe('DEPTH13');
  });

  it('undefined sku keeps current behavior (no -ARTICLE suffix)', () => {
    expect(abfBoreLayer(bore({ depth: 13 }), 'face')).toBe('DEPTH13');
  });
});

describe('ABF_OUTLINE_LAYER', () => {
  it('is the ABF cutting-lines layer name', () => {
    expect(ABF_OUTLINE_LAYER).toBe('ABF_cuttingLines');
  });
});
