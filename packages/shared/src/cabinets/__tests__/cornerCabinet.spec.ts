import { describe, it, expect } from 'vitest';
import type { MaterialEntry } from '../../material';
import { buildCornerCabinet } from '../cornerCabinet';
import type { CornerCabinetParams } from '../types';
import { CabinetTemplateError } from '../types';

const carcass: MaterialEntry = {
  id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896',
};
const back: MaterialEntry = {
  id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47',
};
const REGISTRY: ReadonlyArray<MaterialEntry> = [carcass, back];

// Leg 1 runs along +X (length width1, depth depth1 into the room on Y).
// Leg 2 runs along +Y (length width2, depth depth2 into the room on X).
// L-area = width1·depth1 + depth2·(width2 − depth1).
const DEFAULT_PARAMS: CornerCabinetParams = {
  name: 'Corner 1',
  width1: 900, depth1: 350,
  width2: 600, depth2: 350,
  height: 720,
  carcassMaterialId: 'm-birch-18',
  backMaterialId: 'm-hb-6',
  bandMaterialId: null,
};

describe('buildCornerCabinet — structure', () => {
  it('emits panels including a cornerPost, two legs, two backs, L-floor + L-top', () => {
    const out = buildCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    const roles = out.panels.map((p) => p.role);
    expect(roles).toContain('cornerPost');
    expect(roles.filter((r) => r === 'cornerPost')).toHaveLength(1);
    // Two outer side panels (one per leg end).
    expect(roles.filter((r) => r === 'leftSide' || r === 'rightSide')).toHaveLength(2);
    // L-floor + L-top are two panels each.
    expect(roles.filter((r) => r === 'bottom')).toHaveLength(2);
    expect(roles.filter((r) => r === 'top')).toHaveLength(2);
    expect(roles.filter((r) => r === 'back')).toHaveLength(2);
    expect(out.panels).toHaveLength(9);
  });

  it('emits a layout entry per panel with matching, unique fileNameSuffix', () => {
    const out = buildCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    const panelSuffixes = out.panels.map((p) => p.fileNameSuffix);
    const layoutSuffixes = out.layout.map((c) => c.fileNameSuffix);
    expect(layoutSuffixes).toEqual(panelSuffixes);
    expect(new Set(panelSuffixes).size).toBe(panelSuffixes.length);
  });

  it('every layout entry is zero-rotation (flat-slab model, matches base cabinet)', () => {
    const out = buildCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    for (const c of out.layout) {
      expect(c.rotation).toEqual({ rx: 0, ry: 0, rz: 0 });
    }
  });
});

describe('buildCornerCabinet — L-floor footprint', () => {
  it('the two bottom panels form an L whose area < the bounding rectangle', () => {
    const out = buildCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    const bottoms = out.panels.filter((p) => p.role === 'bottom');
    const area = bottoms.reduce((sum, b) => {
      const l = (b.panel.length as { value: number }).value;
      const w = (b.panel.width as { value: number }).value;
      return sum + l * w;
    }, 0);
    // L-area = 900·350 + 350·(600−350) = 315000 + 87500 = 402500.
    expect(area).toBe(402500);
    // Strictly less than the full bounding rectangle width1·width2 = 540000,
    // proving the footprint is an L and not a filled rectangle.
    expect(area).toBeLessThan(900 * 600);
  });

  it('the two bottom panels do not overlap (leg-1 floor + non-overlapping leg-2 strip)', () => {
    const out = buildCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    const b1 = out.layout.find((c) => c.fileNameSuffix === 'Bottom 1')!;
    const b2 = out.layout.find((c) => c.fileNameSuffix === 'Bottom 2')!;
    // Floor A covers the full leg-1 footprint at the origin.
    expect(b1.position).toEqual({ x: 0, y: 0, z: 0 });
    // Floor B is the leg-2 strip beyond the shared corner zone (y starts at depth1).
    expect(b2.position).toEqual({ x: 0, y: 350, z: 0 });
    const b2panel = out.panels.find((p) => p.fileNameSuffix === 'Bottom 2')!;
    expect(b2panel.panel.length).toEqual({ kind: 'literal', value: 350 }); // depth2
    expect(b2panel.panel.width).toEqual({ kind: 'literal', value: 250 });  // width2 − depth1
  });
});

describe('buildCornerCabinet — corner post', () => {
  it('is a full-height square post seated at the reentrant inner corner', () => {
    const out = buildCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    const post = out.panels.find((p) => p.role === 'cornerPost')!;
    expect(post.panel.length).toEqual({ kind: 'literal', value: 720 }); // full height
    expect(post.panel.width).toEqual({ kind: 'literal', value: 18 });   // Tc
    expect(post.panel.thickness).toEqual({ kind: 'literal', value: 18 }); // Tc
    const postLayout = out.layout.find((c) => c.fileNameSuffix === post.fileNameSuffix)!;
    // Reentrant inner corner at (depth2, depth1) = (350, 350); post tucked inside.
    expect(postLayout.position).toEqual({ x: 350 - 18, y: 350 - 18, z: 0 });
  });
});

describe('buildCornerCabinet — outer sides + backs', () => {
  it('places leg-1 end side at far X and leg-2 end side at far Y', () => {
    const out = buildCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    const leg1End = out.layout.find((c) => c.fileNameSuffix === 'Leg 1 End')!;
    const leg2End = out.layout.find((c) => c.fileNameSuffix === 'Leg 2 End')!;
    expect(leg1End.position).toEqual({ x: 900 - 18, y: 0, z: 0 }); // width1 − Tc
    expect(leg2End.position).toEqual({ x: 0, y: 600 - 18, z: 0 }); // width2 − Tc
  });

  it('the two top panels sit at Z = H − Tc', () => {
    const out = buildCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    const tops = out.layout.filter((c) => c.fileNameSuffix.startsWith('Top '));
    expect(tops).toHaveLength(2);
    for (const t of tops) expect(t.position.z).toBe(720 - 18);
  });
});

describe('buildCornerCabinet — validation', () => {
  function expectError(params: Partial<CornerCabinetParams>, kind: string): void {
    expect(() => buildCornerCabinet({ ...DEFAULT_PARAMS, ...params }, REGISTRY))
      .toThrow(expect.objectContaining({ name: 'CabinetTemplateError', kind }));
  }

  it('rejects empty name', () => expectError({ name: '  ' }, 'nameEmpty'));
  it('rejects width1 ≤ 2·Tc', () => expectError({ width1: 36 }, 'cornerWidthTooSmall'));
  it('rejects width2 ≤ 2·Tc', () => expectError({ width2: 36 }, 'cornerWidthTooSmall'));
  it('rejects depth1 ≤ 2·Tc', () => expectError({ depth1: 36 }, 'cornerDepthTooSmall'));
  it('rejects depth2 ≤ 2·Tc', () => expectError({ depth2: 36 }, 'cornerDepthTooSmall'));
  it('rejects height ≤ 2·Tc', () => expectError({ height: 30 }, 'heightTooSmall'));
  it('rejects leg1 not extending past the corner (width1 ≤ depth2)', () =>
    expectError({ width1: 300, depth2: 350 }, 'cornerLegTooShort'));
  it('rejects leg2 not extending past the corner (width2 ≤ depth1)', () =>
    expectError({ width2: 300, depth1: 350 }, 'cornerLegTooShort'));
  it('rejects missing carcass material', () =>
    expectError({ carcassMaterialId: 'nope' }, 'carcassMaterialMissing'));
  it('rejects missing back material', () =>
    expectError({ backMaterialId: 'nope' }, 'backMaterialMissing'));

  it('populates CabinetTemplateError instance for leg-too-short', () => {
    try { buildCornerCabinet({ ...DEFAULT_PARAMS, width2: 300, depth1: 350 }, REGISTRY); }
    catch (e) { expect(e).toBeInstanceOf(CabinetTemplateError); }
  });
});
