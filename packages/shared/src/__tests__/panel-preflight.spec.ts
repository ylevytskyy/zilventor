import { describe, expect, it } from 'vitest';
import { panelPreflight, type PanelPreflightInput } from '../panel-preflight';

describe('panelPreflight', () => {
  it('passes a normally-authored parametric panel (name + material, single solid)', () => {
    const input: PanelPreflightInput = { name: 'Left Side', materialId: 'm-birch-18', solidCount: 1 };
    expect(panelPreflight(input)).toEqual({ kind: 'pass' });
  });

  it('reports split-required for a multi-solid STEP import', () => {
    const input: PanelPreflightInput = { name: 'Imported.step', materialId: 'm-birch-18', solidCount: 3 };
    expect(panelPreflight(input)).toEqual({
      kind: 'split-required',
      reasonKey: 'panel.preflight.splitRequired',
      solidCount: 3,
    });
  });

  it('fails with a named reason for a deliberately non-manifold solid', () => {
    const input: PanelPreflightInput = { name: 'Broken', materialId: 'm-birch-18', solidCount: 1, isManifold: false };
    expect(panelPreflight(input)).toEqual({ kind: 'fail', reasonKey: 'panel.preflight.notManifold' });
  });

  it('fails with a named reason when the name is missing', () => {
    const input: PanelPreflightInput = { name: '', materialId: 'm-birch-18', solidCount: 1 };
    expect(panelPreflight(input)).toEqual({ kind: 'fail', reasonKey: 'panel.preflight.missingName' });
  });

  it('fails with a named reason when the material is missing', () => {
    const input: PanelPreflightInput = { name: 'Left Side', materialId: undefined, solidCount: 1 };
    expect(panelPreflight(input)).toEqual({ kind: 'fail', reasonKey: 'panel.preflight.missingMaterial' });
  });
});
