import { describe, expect, it } from 'vitest';
import { isPanelFeature, type PanelFeature } from '../panel-feature';
import type { Feature } from '../types';

const PANEL: PanelFeature = {
  kind: 'panel',
  id: 'pf-1',
  length: { kind: 'literal', value: 600 },
  width: { kind: 'literal', value: 400 },
  thickness: { kind: 'literal', value: 18 },
  thicknessFromMaterial: true,
  materialId: 'mat-birch-18',
  grain: 'length',
  edgeBands: { front: null, back: null, left: null, right: null },
};

describe('PanelFeature', () => {
  it('isPanelFeature accepts a well-formed feature', () => {
    expect(isPanelFeature(PANEL)).toBe(true);
  });

  it('isPanelFeature rejects another feature kind', () => {
    expect(isPanelFeature({ ...PANEL, kind: 'extrude' } as unknown)).toBe(false);
  });

  it('rejects unknown grain value', () => {
    expect(isPanelFeature({ ...PANEL, grain: 'diagonal' } as unknown)).toBe(false);
  });

  it('typechecks as Feature', () => {
    const f: Feature = PANEL;
    expect(f.kind).toBe('panel');
  });

  it('edge band slot accepts null and {materialId}', () => {
    const banded: PanelFeature = {
      ...PANEL,
      edgeBands: {
        front: { materialId: 'mat-pvc-1' },
        back: null,
        left: { materialId: 'mat-pvc-1' },
        right: null,
      },
    };
    expect(isPanelFeature(banded)).toBe(true);
  });
});
