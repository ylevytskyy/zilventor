import { describe, it, expect } from 'vitest';
import type { MaterialEntry } from '../../material';
import { buildBaseCabinet } from '../baseCabinet';
import type { BaseCabinetParams } from '../types';
import { CabinetTemplateError } from '../types';

const carcass: MaterialEntry = {
  id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896',
};
const back: MaterialEntry = {
  id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47',
};

const REGISTRY: ReadonlyArray<MaterialEntry> = [carcass, back];

const DEFAULT_PARAMS: BaseCabinetParams = {
  name: 'Base Cabinet 1',
  width: 600, depth: 560, height: 720,
  toekickHeight: 100, toekickSetback: 50,
  shelfCount: 1,
  carcassMaterialId: 'm-birch-18',
  backMaterialId: 'm-hb-6',
  bandMaterialId: null,
};

describe('buildBaseCabinet — default params', () => {
  it('emits 7 panels in deterministic role order', () => {
    const out = buildBaseCabinet(DEFAULT_PARAMS, REGISTRY);
    expect(out.panels.map((p) => p.role)).toEqual([
      'leftSide', 'rightSide', 'bottom', 'top', 'back', 'toekick', 'shelf',
    ]);
    expect(out.panels).toHaveLength(7);
    expect(out.layout).toHaveLength(7);
  });

  it('emits a layout entry per panel with matching fileNameSuffix', () => {
    const out = buildBaseCabinet(DEFAULT_PARAMS, REGISTRY);
    const panelSuffixes = out.panels.map((p) => p.fileNameSuffix);
    const layoutSuffixes = out.layout.map((c) => c.fileNameSuffix);
    expect(layoutSuffixes).toEqual(panelSuffixes);
  });
});

describe('buildBaseCabinet — geometry (defaults)', () => {
  it('places left side at X=0, right side at X = W − Tc', () => {
    const out = buildBaseCabinet(DEFAULT_PARAMS, REGISTRY);
    const left = out.layout.find((c) => c.fileNameSuffix === 'Left Side')!;
    const right = out.layout.find((c) => c.fileNameSuffix === 'Right Side')!;
    expect(left.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(right.position).toEqual({ x: 600 - 18, y: 0, z: 0 });
  });

  it('places bottom at Z = toekickHeight, inset by Tc on X and Tb on Y', () => {
    const out = buildBaseCabinet(DEFAULT_PARAMS, REGISTRY);
    const bottom = out.layout.find((c) => c.fileNameSuffix === 'Bottom')!;
    expect(bottom.position).toEqual({ x: 18, y: 6, z: 100 });
  });

  it('places top at Z = H − Tc', () => {
    const out = buildBaseCabinet(DEFAULT_PARAMS, REGISTRY);
    const top = out.layout.find((c) => c.fileNameSuffix === 'Top')!;
    expect(top.position).toEqual({ x: 18, y: 6, z: 720 - 18 });
  });

  it('places back flush against back wall (Y=0) at full W × H × Tb', () => {
    const out = buildBaseCabinet(DEFAULT_PARAMS, REGISTRY);
    const back = out.layout.find((c) => c.fileNameSuffix === 'Back')!;
    expect(back.position).toEqual({ x: 0, y: 0, z: 0 });
    const backPanel = out.panels.find((p) => p.role === 'back')!;
    expect(backPanel.panel.thickness).toEqual({ kind: 'literal', value: 6 });
    expect(backPanel.panel.length).toEqual({ kind: 'literal', value: 600 });
    expect(backPanel.panel.width).toEqual({ kind: 'literal', value: 720 });
  });

  it('places toekick at Y = D − setback − Tc, Z = 0', () => {
    const out = buildBaseCabinet(DEFAULT_PARAMS, REGISTRY);
    const tk = out.layout.find((c) => c.fileNameSuffix === 'Toekick')!;
    expect(tk.position).toEqual({ x: 18, y: 560 - 50 - 18, z: 0 });
    const tkPanel = out.panels.find((p) => p.role === 'toekick')!;
    expect(tkPanel.panel.length).toEqual({ kind: 'literal', value: 600 - 36 });
    expect(tkPanel.panel.width).toEqual({ kind: 'literal', value: 100 });
    expect(tkPanel.panel.thickness).toEqual({ kind: 'literal', value: 18 });
  });
});

describe('buildBaseCabinet — shelves', () => {
  it('shelfCount=0 emits no shelf panel', () => {
    const out = buildBaseCabinet({ ...DEFAULT_PARAMS, shelfCount: 0 }, REGISTRY);
    expect(out.panels.filter((p) => p.role === 'shelf')).toHaveLength(0);
    expect(out.panels).toHaveLength(6);
  });

  it('shelfCount=3 emits 3 evenly-spaced shelves between bottom and top', () => {
    const params = { ...DEFAULT_PARAMS, shelfCount: 3 };
    const out = buildBaseCabinet(params, REGISTRY);
    const shelves = out.panels.filter((p) => p.role === 'shelf');
    expect(shelves).toHaveLength(3);
    expect(shelves.map((s) => s.shelfIndex)).toEqual([1, 2, 3]);
    // Inner span: H − tkH − 2·Tc = 720 − 100 − 36 = 584; step = 584/4 = 146.
    // Z values (measured from inner bottom = tkH + Tc = 118):
    // 118 + 146 = 264, 410, 556.
    const layout = out.layout.filter((c) => c.fileNameSuffix.startsWith('Shelf '));
    expect(layout.map((c) => c.position.z)).toEqual([264, 410, 556]);
  });

  it('shelf width is shrunk by SHELF_DEPTH_SHRINK_MM (20mm) for finger clearance', () => {
    const out = buildBaseCabinet(DEFAULT_PARAMS, REGISTRY);
    const shelf = out.panels.find((p) => p.role === 'shelf')!;
    // Bottom width is D − Tb = 560 − 6 = 554; shelf is 554 − 20 = 534.
    expect(shelf.panel.width).toEqual({ kind: 'literal', value: 534 });
  });

  it('shelf fileNameSuffix is "Shelf N" with 1-based index', () => {
    const out = buildBaseCabinet({ ...DEFAULT_PARAMS, shelfCount: 2 }, REGISTRY);
    const shelves = out.panels.filter((p) => p.role === 'shelf');
    expect(shelves.map((s) => s.fileNameSuffix)).toEqual(['Shelf 1', 'Shelf 2']);
  });
});

describe('buildBaseCabinet — toekick disabled (toekickHeight=0)', () => {
  it('emits no toekick panel and bottom sits at Z=0', () => {
    const out = buildBaseCabinet({ ...DEFAULT_PARAMS, toekickHeight: 0 }, REGISTRY);
    expect(out.panels.filter((p) => p.role === 'toekick')).toHaveLength(0);
    const bottom = out.layout.find((c) => c.fileNameSuffix === 'Bottom')!;
    expect(bottom.position.z).toBe(0);
  });

  it('shelves redistribute over the larger inner span when toekick=0', () => {
    const params = { ...DEFAULT_PARAMS, toekickHeight: 0, shelfCount: 1 };
    const out = buildBaseCabinet(params, REGISTRY);
    const shelf = out.layout.find((c) => c.fileNameSuffix === 'Shelf 1')!;
    // Inner span = 720 − 0 − 36 = 684; step = 684/2 = 342; z = 18 + 342 = 360.
    expect(shelf.position.z).toBe(360);
  });
});

describe('buildBaseCabinet — validation', () => {
  function expectError(params: Partial<BaseCabinetParams>, kind: string): void {
    expect(() => buildBaseCabinet({ ...DEFAULT_PARAMS, ...params }, REGISTRY))
      .toThrow(expect.objectContaining({ name: 'CabinetTemplateError', kind }));
  }

  it('rejects empty name', () => expectError({ name: '   ' }, 'nameEmpty'));
  it('rejects width ≤ 2·Tc', () => expectError({ width: 36 }, 'widthTooSmall'));
  it('rejects depth ≤ 2·Tc', () => expectError({ depth: 36 }, 'depthTooSmall'));
  it('rejects height ≤ 2·Tc + toekick', () => expectError({ height: 100 }, 'heightTooSmall'));
  it('rejects toekickHeight ≥ H/2', () => expectError({ toekickHeight: 360 }, 'toekickHeightTooLarge'));
  it('rejects toekickSetback ≥ depth − Tc', () => expectError({ toekickSetback: 600 }, 'toekickSetbackTooLarge'));

  it('rejects shelfCount > maxShelves with details.maxShelves populated', () => {
    // Inner H = 720 − 100 − 36 = 584; max = floor(584/100) = 5.
    expect(() => buildBaseCabinet({ ...DEFAULT_PARAMS, shelfCount: 99 }, REGISTRY))
      .toThrow(expect.objectContaining({ kind: 'shelfCountTooLarge' }));
    try { buildBaseCabinet({ ...DEFAULT_PARAMS, shelfCount: 99 }, REGISTRY); }
    catch (e) {
      expect(e).toBeInstanceOf(CabinetTemplateError);
      expect((e as CabinetTemplateError).details.maxShelves).toBe(5);
    }
  });

  it('rejects missing carcass material', () => {
    expect(() => buildBaseCabinet({ ...DEFAULT_PARAMS, carcassMaterialId: 'nope' }, REGISTRY))
      .toThrow(expect.objectContaining({ kind: 'carcassMaterialMissing' }));
  });

  it('rejects missing back material', () => {
    expect(() => buildBaseCabinet({ ...DEFAULT_PARAMS, backMaterialId: 'nope' }, REGISTRY))
      .toThrow(expect.objectContaining({ kind: 'backMaterialMissing' }));
  });
});
