import { describe, it, expect } from 'vitest';
import { renderPanelManufacturingDxf, tenonMortiseRects, boreToFlat } from '../renderPanelManufacturingDxf';
import type { PanelManufacturingInput } from '../renderPanelManufacturingDxf';
import type { BoreOp, GrooveFeature, TenonMortiseFeature, KeyholeSlotFeature } from '@zilventor/shared';
import { parseDxf, syntheticSideBoreToReal } from '@zilventor/shared';

const base: PanelManufacturingInput = {
  itemNumber: 1,
  partName: 'SidePanel',
  materialName: 'Egger White 18',
  qty: 2,
  spec: { length: 800, width: 600, thickness: 18, materialId: 'm1', grain: 'length',
    edgeBands: { front: null, back: null, left: null, right: null } } as any,
  bores: [],
  grooves: [],
};

function tenonMortise(over: Partial<TenonMortiseFeature> = {}): TenonMortiseFeature {
  return {
    kind: 'tenonMortise', id: 'tm1', pairId: 'pair1', role: 'mortise', faceRole: 'Top',
    axis: 'u', position: 100, width: 10, depth: 8, count: 1, spacing: 0, fitClearance: 1,
    ...over,
  };
}

function bore(role: string, u: number, v: number, diameter: number,
              depth: number | 'throughAll'): BoreOp {
  const face: BoreOp['face'] = { featureId: 'panel', role, instance: 0 };
  return { id: `b-${role}-${u}-${v}`, face, u, v, diameter, depth, role: 'shelfPin-system32' } as BoreOp;
}

function keyholeSlot(over: Partial<KeyholeSlotFeature> = {}): KeyholeSlotFeature {
  return {
    kind: 'keyholeSlot', id: 'ks1', faceRole: 'Top', u: 200, v: 150, axis: 'u', direction: 1,
    entryDiameter: 15, slotWidth: 10, slotLength: 25, depth: 6,
    ...over,
  };
}

describe('renderPanelManufacturingDxf — outline/info/dims', () => {
  it('draws a closed outline polyline at L x W on the OUTLINE layer', () => {
    const dxf = renderPanelManufacturingDxf(base);
    expect(dxf).toContain('OUTLINE');
    expect(dxf).toContain('LWPOLYLINE');
    // four corners of an 800x600 rect present as vertices
    expect(dxf).toMatch(/\n800\.0+\n/);
    expect(dxf).toMatch(/\n600\.0+\n/);
  });
  it('emits an INFO text block with item#, material, dims, qty', () => {
    const dxf = renderPanelManufacturingDxf(base);
    expect(dxf).toContain('INFO');
    expect(dxf).toContain('#1');
    expect(dxf).toContain('Egger White 18');
    expect(dxf).toContain('800x600x18');
    expect(dxf).toContain('Qty: 2');
  });
  it('emits two native DIMENSION entities for L and W', () => {
    const dxf = renderPanelManufacturingDxf(base);
    const dims = dxf.match(/\nDIMENSION\n/g) ?? [];
    expect(dims.length).toBe(2);
    expect(dxf).toContain('DIMENSIONS');
  });
});

describe('renderPanelManufacturingDxf — bores', () => {
  it('places a Top (front) bore at (u, v) on the BORES-FRONT layer', () => {
    const dxf = renderPanelManufacturingDxf({ ...base,
      bores: [bore('Top', 100, 50, 5, 12)] });
    expect(dxf).toContain('BORES-FRONT-5MM');
    expect(dxf).toMatch(/CIRCLE[\s\S]*?\n100\.0+\n[\s\S]*?\n50\.0+\n/);
    expect(dxf).toContain('BORE-INFO');
    expect(dxf).toContain('%%c5x12'); // depth label, %%c = DXF diameter control code
    expect(dxf).not.toContain('O5x12');
  });
  it('mirrors a Bottom (back) bore to (u, W - v) on the BORES-BACK layer', () => {
    const dxf = renderPanelManufacturingDxf({ ...base,
      bores: [bore('Bottom', 100, 50, 8, 'throughAll')] });
    expect(dxf).toContain('BORES-BACK-8MM');
    // v=50 mirrors to W-v = 550
    expect(dxf).toMatch(/CIRCLE[\s\S]*?\n100\.0+\n[\s\S]*?\n550\.0+\n/);
    expect(dxf).toContain('%%c8 THRU');
    expect(dxf).not.toContain('O8 THRU');
  });
  it('projects a Front edge bore onto the top edge (X=v, Y=W)', () => {
    const dxf = renderPanelManufacturingDxf({ ...base,
      bores: [bore('Front', 9, 300, 5, 32)] }); // v=300 along edge, u=9 depth
    expect(dxf).toContain('BORES-EDGE-Front-5MM');
    expect(dxf).toMatch(/CIRCLE[\s\S]*?\n300\.0+\n[\s\S]*?\n600\.0+\n/);
  });

  // fix/bore-aside-swapuv slice 2: a side-panel A-side bore now persists with role
  // 'Top'/'Bottom' (via syntheticSideBoreToReal), not 'Left'/'Right'. This matters for DXF
  // rendering: boreToFlat's Left/Right cases IGNORE u (pin x to a constant edge, 0 or `len`)
  // and only use v — a 'Right'-role bore would render at a fixed x regardless of u. The
  // 'Top'-role case consumes BOTH u and v, so the remap changes where the hole actually
  // plots on the manufacturing drawing (from a fixed-edge point to a real (u,v) position).
  it('a syntheticSideBoreToReal-remapped side-panel bore plots at (u, v), not a fixed edge', () => {
    const rawSynthetic = bore('Right', 9, 300, 7, 'throughAll'); // pre-remap: role='Right'
    const remapped = syntheticSideBoreToReal(rawSynthetic);
    expect(remapped.face.role).toBe('Top');

    const dxf = renderPanelManufacturingDxf({ ...base, bores: [remapped] });
    expect(dxf).toContain('BORES-FRONT-7MM');
    // Top case: x=u=9, y=v=300 (both coordinates used) — NOT x=len=800 (the Right-case constant,
    // which boreToFlat's Left/Right branches would have pinned x to, ignoring u entirely).
    expect(dxf).toMatch(/CIRCLE[\s\S]*?\n9\.0+\n[\s\S]*?\n300\.0+\n/);
  });
});

// Groundwork for docs/superpowers/plans/2026-07-04-flip-fence-ratification.md (Q2): pins
// boreToFlat's EXISTING Bottom-face mirror convention (v mirrors across panel width, u
// unchanged) as pre-existing, verified display behavior — distinct from any future flip-fence
// convention the ratification doc's Q2 may settle on.
describe('boreToFlat — Bottom-face mirror convention (pre-existing, pinned)', () => {
  it('mirrors v across panel width and leaves u unchanged for a Bottom-role bore', () => {
    const b = bore('Bottom', 10, 20, 8, 12); // u=10, v=20 on an 800x600 panel
    const flat = boreToFlat(b, 800, 600);
    expect(flat).toEqual({ x: 10, y: 580, layer: 'BORES-BACK-8MM' }); // y = wid(600) - v(20)
  });
});

describe('renderPanelManufacturingDxf — grooves/edgeband/grain', () => {
  it('draws a Top groove centered at position on the GROOVES layer', () => {
    const groove: GrooveFeature = { kind: 'groove', id: 'g1', faceRole: 'Top',
      axis: 'u', position: 10, width: 6, depth: 9 };
    const dxf = renderPanelManufacturingDxf({ ...base, grooves: [groove] });
    expect(dxf).toContain('GROOVES');
    // rect spans X 0..800 at Y 7..13 (centered: position±width/2 = 10±3)
    expect(dxf).toMatch(/\n7\.0+\n/);
    expect(dxf).toMatch(/\n13\.0+\n/);
  });
  it('draws a Bottom groove mirrored+centered: bounds W-7=593 and W-13=587', () => {
    const groove: GrooveFeature = { kind: 'groove', id: 'g2', faceRole: 'Bottom',
      axis: 'u', position: 10, width: 6, depth: 9 };
    // panel W=600; centered y0=7,y1=13; mirrored: 600-7=593, 600-13=587
    const dxf = renderPanelManufacturingDxf({ ...base, grooves: [groove] });
    expect(dxf).toMatch(/\n593\.0+\n/);
    expect(dxf).toMatch(/\n587\.0+\n/);
  });
  it('draws a vertical (axis=v) Top groove centered at position: X bounds 96 and 104', () => {
    const groove: GrooveFeature = { kind: 'groove', id: 'g3', faceRole: 'Top',
      axis: 'v', position: 100, width: 8, depth: 9 };
    // centered: x0=100-4=96, x1=100+4=104
    const dxf = renderPanelManufacturingDxf({ ...base, grooves: [groove] });
    expect(dxf).toMatch(/\n96\.0+\n/);
    expect(dxf).toMatch(/\n104\.0+\n/);
  });
  it('draws an EDGEBAND line only on banded edges', () => {
    const banded = { ...base, spec: { ...base.spec,
      edgeBands: { front: { materialId: 'e', thickness: 1 }, back: null, left: null, right: null } } };
    const dxf = renderPanelManufacturingDxf(banded as any);
    expect(dxf).toContain('EDGEBAND');
  });
  it('omits the GRAIN layer when grain is none', () => {
    const dxf = renderPanelManufacturingDxf({ ...base,
      spec: { ...base.spec, grain: 'none' } as any });
    expect(dxf).not.toContain('\nGRAIN\n');
  });
  it('draws a GRAIN arrow when grain is length', () => {
    const dxf = renderPanelManufacturingDxf(base); // grain 'length'
    expect(dxf).toContain('GRAIN');
  });
});

// P6 W4: tenon/mortise features surface as explicit rect entities, mirroring grooves —
// tenonMortiseRects is the pure projection helper (reused by manufacturingCsv.ts), unlike
// grooveRect it supports all 6 PanelFaceRole values (generateTenonMortisePair can place
// either role on any face depending on the inferred joint's orientation).
describe('tenonMortiseRects — projection helper', () => {
  it('mortise on Top face, unbounded cross axis: spans full width, run axis widened by fitClearance', () => {
    const f = tenonMortise({ faceRole: 'Top', axis: 'u', position: 100, width: 10, fitClearance: 1 });
    const rects = tenonMortiseRects(f, 800, 600);
    expect(rects).toHaveLength(1);
    const xs = rects![0]!.map((p) => p.x);
    const ys = rects![0]!.map((p) => p.y);
    // run axis (x): position±(width/2+fitClearance) = 100±6
    expect(Math.min(...xs)).toBeCloseTo(94, 6);
    expect(Math.max(...xs)).toBeCloseTo(106, 6);
    // cross axis (y): unbounded → full panel width 0..600
    expect(Math.min(...ys)).toBeCloseTo(0, 6);
    expect(Math.max(...ys)).toBeCloseTo(600, 6);
  });

  it('mortise with crossPosition/crossSpan: bounded pocket rect, NOT a through-dado across the full panel (regression guard)', () => {
    // Left face, len=800 wid=600: crossPosition=9, crossSpan=18, fitClearance=1 →
    // cross extent = 18 + 2*1 = 20, nowhere near the host's full 600mm width.
    const f = tenonMortise({
      faceRole: 'Left', axis: 'u', position: 100, width: 10, depth: 8,
      fitClearance: 1, crossPosition: 9, crossSpan: 18,
    });
    const rects = tenonMortiseRects(f, 800, 600);
    expect(rects).toHaveLength(1);
    const ys = rects![0]!.map((p) => p.y);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    expect(yMax - yMin).toBeCloseTo(20, 6);
    expect(yMax).toBeLessThan(600); // not the full host width
    // Raw v range [-1,19] pokes 1mm past the panel's v=0 edge — clamped (shifted,
    // span preserved) into [0,20].
    expect(yMin).toBeCloseTo(0, 6);
    expect(yMax).toBeCloseTo(20, 6);
  });

  it('tenon on Right end face protrudes beyond the panel outline by depth (full-thickness footprint, no clearance widening)', () => {
    const f = tenonMortise({
      role: 'tenon', faceRole: 'Right', axis: 'v', position: 100, width: 10, depth: 8, fitClearance: 1,
    });
    const rects = tenonMortiseRects(f, 800, 600);
    expect(rects).toHaveLength(1);
    const xs = rects![0]!.map((p) => p.x);
    const ys = rects![0]!.map((p) => p.y);
    // protrudes past the Right edge (x=len=800) by depth=8; width nominal (no fitClearance widening for tenon)
    expect(Math.min(...xs)).toBeCloseTo(800, 6);
    expect(Math.max(...xs)).toBeCloseTo(808, 6);
    expect(Math.min(...ys)).toBeCloseTo(495, 6);
    expect(Math.max(...ys)).toBeCloseTo(505, 6);
  });

  it('count=2 produces two discrete tab rects at the correct run-axis spacing', () => {
    const f = tenonMortise({
      faceRole: 'Top', axis: 'u', position: 100, width: 10, depth: 8,
      fitClearance: 0, count: 2, spacing: 40,
    });
    const rects = tenonMortiseRects(f, 800, 600);
    expect(rects).toHaveLength(2);
    const centers = rects!.map((r) => {
      const xs = r.map((p) => p.x);
      return (Math.min(...xs) + Math.max(...xs)) / 2;
    }).sort((a, b) => a - b);
    expect(centers[0]).toBeCloseTo(80, 6);
    expect(centers[1]).toBeCloseTo(120, 6);
  });

  it('returns null for an unrecognized face role (defensive, mirrors grooveRect/boreToFlat not-representable convention)', () => {
    const f = tenonMortise({ faceRole: 'Unknown' as unknown as TenonMortiseFeature['faceRole'] });
    expect(tenonMortiseRects(f, 800, 600)).toBeNull();
  });
});

describe('renderPanelManufacturingDxf — tenons/mortises', () => {
  it('draws a mortise rect on the MORTISES layer', () => {
    const m = tenonMortise({ role: 'mortise', faceRole: 'Top', axis: 'u', position: 100, width: 10, fitClearance: 1 });
    const dxf = renderPanelManufacturingDxf({ ...base, tenonMortises: [m] });
    expect(dxf).toContain('MORTISES');
    expect(dxf).toMatch(/\n94\.0+\n/);
    expect(dxf).toMatch(/\n106\.0+\n/);
  });

  it('draws a tenon rect on the TENONS layer', () => {
    const t = tenonMortise({ role: 'tenon', faceRole: 'Right', axis: 'v', position: 100, width: 10, depth: 8, fitClearance: 1 });
    const dxf = renderPanelManufacturingDxf({ ...base, tenonMortises: [t] });
    expect(dxf).toContain('TENONS');
    expect(dxf).toMatch(/\n808\.0+\n/);
  });

  it('a tenonMortise with toolNumber+speed emits CAM XDATA', () => {
    const m = tenonMortise({ toolNumber: 4, speed: 15000 });
    const dxf = renderPanelManufacturingDxf({ ...base, tenonMortises: [m] });
    expect(dxf).toContain('1001\nZILVENTOR');
    expect(dxf).toContain('1000\nTOOL_NUMBER');
    expect(dxf).toContain('1070\n4');
    expect(dxf).toContain('1000\nSPEED');
    expect(dxf).toContain('1040\n15000.0000');
  });

  it('a tenonMortise with presetLayerName routes onto the custom layer, not MORTISES', () => {
    const m = tenonMortise({ presetLayerName: 'CNC-TENON-1' });
    const dxf = renderPanelManufacturingDxf({ ...base, tenonMortises: [m] });
    expect(dxf).toContain('CNC-TENON-1');
    expect(dxf).not.toContain('\nMORTISES\n');
  });
});

// P16: a KeyholeSlotFeature (wall-hanger routing) surfaces as an entry-hole CIRCLE + a
// slot-outline LWPOLYLINE on the KEYHOLE-SLOTS layer. Like grooveRect, restricted to
// Top/Bottom faces — Front/Back/Left/Right are drawn as 1D border lines in this flat
// panel-plan format, so a slot's WIDTH (the cross axis) has no representable extent there.
describe('renderPanelManufacturingDxf — keyhole slots', () => {
  it('draws a Top-face keyhole slot entry circle + slot rect on the KEYHOLE-SLOTS layer', () => {
    const ks = keyholeSlot({ faceRole: 'Top', u: 200, v: 150, axis: 'u', direction: 1,
      entryDiameter: 15, slotWidth: 10, slotLength: 25 });
    const dxf = renderPanelManufacturingDxf({ ...base, keyholeSlots: [ks] });
    expect(dxf).toContain('KEYHOLE-SLOTS');
    // entry circle at (u,v) = (200,150), r = entryDiameter/2 = 7.5
    expect(dxf).toMatch(/CIRCLE[\s\S]*?\n200\.0+\n[\s\S]*?\n150\.0+\n[\s\S]*?\n7\.5\d*\n/);
    // slot rect: run axis u from 200 to 225, cross axis v centered at 150±5 -> 145/155
    expect(dxf).toMatch(/\n225\.0+\n/);
    expect(dxf).toMatch(/\n145\.0+\n/);
    expect(dxf).toMatch(/\n155\.0+\n/);
  });

  it('mirrors a Bottom-face keyhole slot along v (matches grooveRect\'s v-flip convention)', () => {
    // Bottom, wid=600: cy = wid-v = 600-50=550; axis=v,direction=1 runs toward -y (mirrored)
    // -> far y = 550-20=530; cross axis u, half=3 -> x bounds 100±3 = 97/103.
    const ks = keyholeSlot({ faceRole: 'Bottom', u: 100, v: 50, axis: 'v', direction: 1,
      entryDiameter: 10, slotWidth: 6, slotLength: 20 });
    const dxf = renderPanelManufacturingDxf({ ...base, keyholeSlots: [ks] });
    expect(dxf).toMatch(/\n550\.0+\n/);
    expect(dxf).toMatch(/\n530\.0+\n/);
    expect(dxf).toMatch(/\n97\.0+\n/);
    expect(dxf).toMatch(/\n103\.0+\n/);
  });

  it('omits the KEYHOLE-SLOTS layer for a non-Top/Bottom face (edge faces unrepresentable, mirrors grooveRect rejection)', () => {
    const ks = keyholeSlot({ faceRole: 'Left', axis: 'v', direction: 1 });
    const dxf = renderPanelManufacturingDxf({ ...base, keyholeSlots: [ks] });
    expect(dxf).not.toContain('KEYHOLE-SLOTS');
  });

  it('omits the KEYHOLE-SLOTS layer when keyholeSlots is absent (legacy callers, mirrors grooves/tenonMortises contract)', () => {
    const dxf = renderPanelManufacturingDxf(base);
    expect(dxf).not.toContain('KEYHOLE-SLOTS');
  });

  it('a keyhole slot with toolNumber+speed emits CAM XDATA', () => {
    const ks = keyholeSlot({ toolNumber: 4, speed: 15000 });
    const dxf = renderPanelManufacturingDxf({ ...base, keyholeSlots: [ks] });
    expect(dxf).toContain('1001\nZILVENTOR');
    expect(dxf).toContain('1000\nTOOL_NUMBER');
    expect(dxf).toContain('1070\n4');
    expect(dxf).toContain('1000\nSPEED');
    expect(dxf).toContain('1040\n15000.0000');
  });

  it('a keyhole slot with presetLayerName routes onto the custom layer, not KEYHOLE-SLOTS', () => {
    const ks = keyholeSlot({ presetLayerName: 'CNC-KEYHOLE-1' });
    const dxf = renderPanelManufacturingDxf({ ...base, keyholeSlots: [ks] });
    expect(dxf).toContain('CNC-KEYHOLE-1');
    expect(dxf).not.toContain('\nKEYHOLE-SLOTS\n');
  });
});

// R2.2/R2.3 (docs/abf-plugin/05-parity/03-processing-parity-requirements.md): bores/grooves
// carry optional toolNumber/speed → DXF XDATA, and an optional presetLayerName → layer routing.
describe('renderPanelManufacturingDxf — CAM metadata (XDATA + preset layer routing)', () => {
  it('a bore with toolNumber+speed emits TOOL_NUMBER/SPEED XDATA on its CIRCLE', () => {
    const b = { ...bore('Top', 100, 50, 5, 12), toolNumber: 3, speed: 12000 };
    const dxf = renderPanelManufacturingDxf({ ...base, bores: [b] });
    expect(dxf).toContain('1001\nZILVENTOR');
    expect(dxf).toContain('1000\nTOOL_NUMBER');
    expect(dxf).toContain('1070\n3');
    expect(dxf).toContain('1000\nSPEED');
    expect(dxf).toContain('1040\n12000.0000');
  });

  it('a bore with no CAM fields emits no XDATA (regression — byte-identical to pre-CAM output)', () => {
    const dxf = renderPanelManufacturingDxf({ ...base, bores: [bore('Top', 100, 50, 5, 12)] });
    expect(dxf).not.toContain('1001');
  });

  it('a bore with presetLayerName routes its CIRCLE onto the custom layer, not the standard scheme', () => {
    const b = { ...bore('Top', 100, 50, 5, 12), presetLayerName: 'CNC-TOOL-3' };
    const dxf = renderPanelManufacturingDxf({ ...base, bores: [b] });
    expect(dxf).toContain('CNC-TOOL-3');
    expect(dxf).not.toContain('BORES-FRONT-5MM');
  });

  it('a groove with toolNumber+speed emits TOOL_NUMBER/SPEED XDATA on its LWPOLYLINE', () => {
    const groove: GrooveFeature = { kind: 'groove', id: 'g1', faceRole: 'Top',
      axis: 'u', position: 10, width: 6, depth: 9, toolNumber: 7, speed: 18000 };
    const dxf = renderPanelManufacturingDxf({ ...base, grooves: [groove] });
    expect(dxf).toContain('1001\nZILVENTOR');
    expect(dxf).toContain('1000\nTOOL_NUMBER');
    expect(dxf).toContain('1070\n7');
    expect(dxf).toContain('1000\nSPEED');
    expect(dxf).toContain('1040\n18000.0000');
  });

  it('a groove with no CAM fields emits no XDATA (regression — byte-identical to pre-CAM output)', () => {
    const groove: GrooveFeature = { kind: 'groove', id: 'g1', faceRole: 'Top',
      axis: 'u', position: 10, width: 6, depth: 9 };
    const dxf = renderPanelManufacturingDxf({ ...base, grooves: [groove] });
    expect(dxf).not.toContain('1001');
  });

  it('a groove with presetLayerName routes its LWPOLYLINE onto the custom layer, not GROOVES', () => {
    const groove: GrooveFeature = { kind: 'groove', id: 'g1', faceRole: 'Top',
      axis: 'u', position: 10, width: 6, depth: 9, presetLayerName: 'CNC-GROOVE-1' };
    const dxf = renderPanelManufacturingDxf({ ...base, grooves: [groove] });
    expect(dxf).toContain('CNC-GROOVE-1');
    expect(dxf).not.toContain('\nGROOVES\n');
  });
});

// R4.3 (docs/abf-plugin/05-parity/03-processing-parity-requirements.md lines 73-90):
// bores/curved features must be real CIRCLE/ARC entities, never LWPOLYLINE-approximated
// circles. These tests parse the actual DXF output (instead of regexing raw text) to lock
// that fidelity.
// ABF layer scheme (docs/abf-plugin/05-parity/04-abf-flatten-dxf-sample-analysis.md §3):
// an optional opts.layerScheme param renames bore + outline layers to the ABF convention.
// Additive-default contract: omitted/'native' must be byte-identical to pre-existing output.
describe('renderPanelManufacturingDxf — ABF layer scheme', () => {
  it('a face bore with a sku gets DEPTH<d>-ARTICLE<sku> under abf scheme', () => {
    const b = { ...bore('Top', 100, 50, 5, 12), sku: 'X123' };
    const dxf = renderPanelManufacturingDxf({ ...base, bores: [b] }, { layerScheme: 'abf' });
    expect(dxf).toContain('DEPTH12-ARTICLEX123');
    expect(dxf).not.toContain('BORES-FRONT-5MM');
  });

  it('a face bore with no sku gets a bare DEPTH<d> layer under abf scheme', () => {
    const b = bore('Top', 100, 50, 5, 12);
    const dxf = renderPanelManufacturingDxf({ ...base, bores: [b] }, { layerScheme: 'abf' });
    expect(dxf).toContain('\nDEPTH12\n');
    expect(dxf).not.toContain('ARTICLE');
  });

  it('an edge bore gets ABF-DSIDE-<dia> under abf scheme (sku ignored)', () => {
    const b = { ...bore('Front', 9, 300, 5, 32), sku: 'IGNORED' };
    const dxf = renderPanelManufacturingDxf({ ...base, bores: [b] }, { layerScheme: 'abf' });
    expect(dxf).toContain('ABF-DSIDE-5');
    expect(dxf).not.toContain('IGNORED');
  });

  it('a throughAll face bore falls back to the native layer name under abf scheme (no invented THRU convention)', () => {
    const b = bore('Bottom', 100, 50, 8, 'throughAll');
    const dxf = renderPanelManufacturingDxf({ ...base, bores: [b] }, { layerScheme: 'abf' });
    expect(dxf).toContain('BORES-BACK-8MM');
    expect(dxf).not.toContain('DEPTH');
  });

  it('presetLayerName still wins over the ABF layer name', () => {
    const b = { ...bore('Top', 100, 50, 5, 12), sku: 'X123', presetLayerName: 'CNC-TOOL-3' };
    const dxf = renderPanelManufacturingDxf({ ...base, bores: [b] }, { layerScheme: 'abf' });
    expect(dxf).toContain('CNC-TOOL-3');
    expect(dxf).not.toContain('DEPTH12-ARTICLEX123');
  });

  it('the outline goes on ABF_cuttingLines under abf scheme', () => {
    const dxf = renderPanelManufacturingDxf(base, { layerScheme: 'abf' });
    expect(dxf).toContain('ABF_cuttingLines');
    expect(dxf).not.toContain('\nOUTLINE\n');
  });

  it('grooves stay on the native GROOVES layer under abf scheme (ratified passthrough)', () => {
    const groove: GrooveFeature = { kind: 'groove', id: 'g1', faceRole: 'Top',
      axis: 'u', position: 10, width: 6, depth: 9 };
    const dxf = renderPanelManufacturingDxf({ ...base, grooves: [groove] }, { layerScheme: 'abf' });
    expect(dxf).toContain('GROOVES');
  });

  it('regression: {layerScheme:"native"} output is byte-identical to opts omitted', () => {
    const input: PanelManufacturingInput = { ...base,
      bores: [{ ...bore('Top', 100, 50, 5, 12), sku: 'X123' }, bore('Front', 9, 300, 5, 32)] };
    expect(renderPanelManufacturingDxf(input, { layerScheme: 'native' })).toBe(renderPanelManufacturingDxf(input));
  });
});

describe('renderPanelManufacturingDxf — DXF fidelity (parse-based)', () => {
  it('every BORES-* layer entity parses as a real CIRCLE, never an approximated polyline', () => {
    const dxf = renderPanelManufacturingDxf({
      ...base,
      bores: [
        bore('Top', 100, 50, 5, 12),
        bore('Bottom', 100, 50, 8, 'throughAll'),
        bore('Front', 9, 300, 5, 32),
      ],
    });
    const parsed = parseDxf(dxf);
    const boreEntities = parsed.entities.filter((e) => e.layer.startsWith('BORES-'));
    expect(boreEntities.length).toBeGreaterThan(0);
    expect(boreEntities.every((e) => e.type === 'CIRCLE')).toBe(true);
  });

  it('emits no closed LWPOLYLINE with more than 4 vertices anywhere (no polyline circles)', () => {
    const groove: GrooveFeature = { kind: 'groove', id: 'g1', faceRole: 'Top',
      axis: 'u', position: 10, width: 6, depth: 9 };
    const dxf = renderPanelManufacturingDxf({
      ...base,
      bores: [bore('Top', 100, 50, 5, 12)],
      grooves: [groove],
    });
    const parsed = parseDxf(dxf);
    const closedPolys = parsed.entities.filter((e) => e.type === 'LWPOLYLINE' && e.closed);
    expect(closedPolys.every((e) => e.type === 'LWPOLYLINE' && e.vertices.length <= 4)).toBe(true);
  });
});
