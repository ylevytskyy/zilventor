// packages/shared/src/drawing/__tests__/applyBreaks.spec.ts
import { describe, it, expect } from 'vitest';
import { applyBreaks } from '../applyBreaks';
import type { Edge2D } from '../projectedGeometry';
import type { BreakRegion } from '../types';

// ---------------------------------------------------------------------------
// T2.1 — module skeleton
// ---------------------------------------------------------------------------

describe('applyBreaks — module skeleton', () => {
  it('T2.1 empty edges + empty breaks → empty result', () => {
    const result = applyBreaks([], [], { minX: 0, minY: 0, maxX: 0, maxY: 0 });
    expect(result.edges).toEqual([]);
    expect(result.breakSymbolEdges).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T2.2 — clipEdge1D helper (tested via applyBreaks behaviour)
// ---------------------------------------------------------------------------

describe('applyBreaks — clipEdge1D helper (via applyBreaks behaviour)', () => {
  const BBOX = { minX: 0, minY: -5, maxX: 400, maxY: 5 };

  it('T2.2a entirely before band → kept whole, id unchanged', () => {
    const e: Edge2D = { id: 'e1', kind: 'outline', points: [[0,0],[40,0]] };
    const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };
    const { edges } = applyBreaks([e], [br], BBOX);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.id).toBe('e1');
    expect(edges[0]!.points[0]).toEqual([0, 0]);
    expect(edges[0]!.points[1]).toEqual([40, 0]);
  });

  it('T2.2b entirely after band → id unchanged, x translated by −(coordB−coordA−gapMm)', () => {
    const e: Edge2D = { id: 'e2', kind: 'outline', points: [[120,0],[200,0]] };
    const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };
    const { edges } = applyBreaks([e], [br], BBOX);
    // shift = −(100−50−5) = −45; 120−45=75, 200−45=155
    expect(edges).toHaveLength(1);
    expect(edges[0]!.id).toBe('e2');
    expect(edges[0]!.points[0]![0]).toBeCloseTo(75, 5);
    expect(edges[0]!.points[1]![0]).toBeCloseTo(155, 5);
  });

  it('T2.2c entirely inside band → dropped', () => {
    const e: Edge2D = { id: 'e3', kind: 'outline', points: [[60,0],[90,0]] };
    const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };
    const { edges } = applyBreaks([e], [br], BBOX);
    expect(edges).toHaveLength(0);
  });

  it('T2.2d spanning full band → two fragments', () => {
    const e: Edge2D = { id: 'e4', kind: 'outline', points: [[0,0],[200,0]] };
    const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };
    const { edges } = applyBreaks([e], [br], BBOX);
    // shift = −45; before: [(0,0),(50,0)] id e4_a; after: [(55,0),(155,0)] id e4_b (100−45=55, 200−45=155)
    expect(edges).toHaveLength(2);
    const a = edges.find(e => e.id === 'e4_a');
    const b = edges.find(e => e.id === 'e4_b');
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a!.points[1]![0]).toBeCloseTo(50, 5);
    expect(b!.points[0]![0]).toBeCloseTo(55, 5);
  });

  it('T2.2e tangent to coordA → kept as "before", id unchanged', () => {
    const e: Edge2D = { id: 'e5', kind: 'outline', points: [[50,0],[50,10]] };
    const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };
    const { edges } = applyBreaks([e], [br], BBOX);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.id).toBe('e5');
  });
});

// ---------------------------------------------------------------------------
// T2.3 — cumulativeShift semantics
// ---------------------------------------------------------------------------

describe('applyBreaks — cumulativeShift semantics', () => {
  it('T2.3a no breaks → shift is 0', () => {
    const e: Edge2D = { id: 'e1', kind: 'outline', points: [[100,0],[200,0]] };
    const { edges } = applyBreaks([e], [], { minX:0, minY:0, maxX:400, maxY:0 });
    expect(edges[0]!.points[0]![0]).toBeCloseTo(100, 5);
  });

  it('T2.3b two x-breaks, point after both → cumulative shift = sum of both shifts', () => {
    // break1: coordA=50, coordB=100, gapMm=5 → shift1=−45
    // break2: coordA=200, coordB=300, gapMm=5 → shift2=−95
    // Point at x=350 → after both → total shift = −140 → new x = 210
    const e: Edge2D = { id: 'e1', kind: 'outline', points: [[350,0],[400,0]] };
    const breaks: BreakRegion[] = [
      { id: 'b1', axis: 'x', coordA: 50,  coordB: 100, gapMm: 5, style: 'zigzag' },
      { id: 'b2', axis: 'x', coordA: 200, coordB: 300, gapMm: 5, style: 'zigzag' },
    ];
    const { edges } = applyBreaks([e], breaks, { minX:0, minY:0, maxX:400, maxY:0 });
    expect(edges[0]!.id).toBe('e1');
    expect(edges[0]!.points[0]![0]).toBeCloseTo(210, 5); // 350 − 140
    expect(edges[0]!.points[1]![0]).toBeCloseTo(260, 5); // 400 − 140
  });

  it('T2.3c x-break and y-break on same edge → axes accumulate independently', () => {
    const e: Edge2D = { id: 'e1', kind: 'outline', points: [[120,120],[200,200]] };
    const breaks: BreakRegion[] = [
      { id: 'bx', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' },
      { id: 'by', axis: 'y', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' },
    ];
    const { edges } = applyBreaks([e], breaks, { minX:0, minY:0, maxX:400, maxY:400 });
    expect(edges[0]!.points[0]![0]).toBeCloseTo(75, 5);
    expect(edges[0]!.points[0]![1]).toBeCloseTo(75, 5);
  });
});

// ---------------------------------------------------------------------------
// T2.4 — emitZigzagPolyline (via break symbol output)
// ---------------------------------------------------------------------------

describe('applyBreaks — emitZigzagPolyline (via break symbol output)', () => {
  const BBOX = { minX: 0, minY: 0, maxX: 300, maxY: 60 };

  it('T2.4a break symbol has kind: "break"', () => {
    const br: BreakRegion = { id: 'bk1', axis: 'x', coordA: 100, coordB: 200, gapMm: 5, style: 'zigzag' };
    const { breakSymbolEdges } = applyBreaks([], [br], BBOX);
    expect(breakSymbolEdges).toHaveLength(1);
    expect(breakSymbolEdges[0]!.kind).toBe('break');
  });

  it('T2.4b break symbol id uses breakId', () => {
    const br: BreakRegion = { id: 'bk42', axis: 'x', coordA: 0, coordB: 50, gapMm: 5, style: 'zigzag' };
    const { breakSymbolEdges } = applyBreaks([], [br], BBOX);
    expect(breakSymbolEdges[0]!.id).toContain('bk42');
  });

  it('T2.4c axis x: symbol points span Y from perpMin-5 to perpMax+5 (with overhang)', () => {
    const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };
    const { breakSymbolEdges } = applyBreaks([], [br], BBOX);
    const pts = breakSymbolEdges[0]!.points;
    // perpMin = minY - 5 = -5; perpMax = maxY + 5 = 65
    const allY = pts.map(p => p[1]);
    expect(Math.min(...allY)).toBeCloseTo(-5, 1);
    expect(Math.max(...allY)).toBeCloseTo(65, 1);
  });

  it('T2.4d axis x: first point x-coord = coordA + gapMm (spine position)', () => {
    const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 100, coordB: 200, gapMm: 5, style: 'zigzag' };
    const { breakSymbolEdges } = applyBreaks([], [br], BBOX);
    // spine_pos = 100 + 5 = 105 (AB-9 binding formula)
    const xCoords = breakSymbolEdges[0]!.points.map(p => p[0]);
    // All x coords must be within amplitude of spine_pos = 105
    xCoords.forEach(x => {
      expect(Math.abs(x - 105)).toBeLessThanOrEqual(1.5 + 1e-9);
    });
  });
});

// ---------------------------------------------------------------------------
// T2.5 — AB-1: edge spanning full band
// ---------------------------------------------------------------------------

describe('AB-1 edge crossing band — both fragments', () => {
  it('T2.5 AB-1: horizontal edge spanning x-break → _a and _b fragments', () => {
    const BBOX = { minX: 0, minY: -5, maxX: 200, maxY: 5 };
    const e: Edge2D = { id: 'edge1', kind: 'outline', points: [[0,0],[200,0]] };
    const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 150, gapMm: 5, style: 'zigzag' };
    const { edges, breakSymbolEdges } = applyBreaks([e], [br], BBOX);

    expect(edges).toHaveLength(2);
    const a = edges.find(e => e.id === 'edge1_a');
    const b = edges.find(e => e.id === 'edge1_b');
    expect(a).toBeDefined();
    expect(b).toBeDefined();

    // Before fragment: [(0,0),(50,0)]
    expect(a!.points[0]![0]).toBeCloseTo(0, 5);
    expect(a!.points[0]![1]).toBeCloseTo(0, 5);
    expect(a!.points[1]![0]).toBeCloseTo(50, 5);

    // After fragment translated: shift = −(150−50−5) = −95; 150−95=55; 200−95=105
    expect(b!.points[0]![0]).toBeCloseTo(55, 5);
    expect(b!.points[1]![0]).toBeCloseTo(105, 5);
    expect(b!.points[0]![1]).toBeCloseTo(0, 5);

    expect(breakSymbolEdges).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// T2.6 — AB-2 and AB-3: entirely before / entirely after
// ---------------------------------------------------------------------------

describe('AB-2 edge entirely before band', () => {
  it('T2.6a AB-2: id unchanged, no translation', () => {
    const BBOX = { minX: 0, minY: -5, maxX: 200, maxY: 5 };
    const e: Edge2D = { id: 'e_before', kind: 'outline', points: [[0,0],[40,0]] };
    const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };
    const { edges } = applyBreaks([e], [br], BBOX);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.id).toBe('e_before');
    expect(edges[0]!.points[0]).toEqual([0, 0]);
    expect(edges[0]!.points[1]).toEqual([40, 0]);
  });
});

describe('AB-3 edge entirely after band', () => {
  it('T2.6b AB-3: id unchanged, x translated by −45', () => {
    const BBOX = { minX: 0, minY: -5, maxX: 200, maxY: 5 };
    const e: Edge2D = { id: 'e_after', kind: 'outline', points: [[120,0],[200,0]] };
    const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };
    const { edges } = applyBreaks([e], [br], BBOX);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.id).toBe('e_after');
    expect(edges[0]!.points[0]![0]).toBeCloseTo(75, 5);
    expect(edges[0]!.points[1]![0]).toBeCloseTo(155, 5);
  });
});

// ---------------------------------------------------------------------------
// T2.7 — AB-4 and AB-5: entirely inside + tangent
// ---------------------------------------------------------------------------

describe('AB-4 edge entirely inside band', () => {
  it('T2.7a AB-4: edge inside band is dropped', () => {
    const BBOX = { minX: 0, minY: -5, maxX: 200, maxY: 5 };
    const e: Edge2D = { id: 'e_inside', kind: 'feature', points: [[60,0],[90,0]] };
    const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };
    const { edges } = applyBreaks([e], [br], BBOX);
    expect(edges).toHaveLength(0);
  });
});

describe('AB-5 edge tangent to coordA', () => {
  it('T2.7b AB-5: vertical edge at exactly x=50 → kept as "before", id unchanged', () => {
    const BBOX = { minX: 0, minY: -5, maxX: 200, maxY: 15 };
    const e: Edge2D = { id: 'e_tang', kind: 'outline', points: [[50,0],[50,10]] };
    const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };
    const { edges } = applyBreaks([e], [br], BBOX);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.id).toBe('e_tang');
    // Not translated (in "before" zone at boundary)
    expect(edges[0]!.points[0]).toEqual([50, 0]);
    expect(edges[0]!.points[1]).toEqual([50, 10]);
  });
});

// ---------------------------------------------------------------------------
// T2.8 — AB-6: two breaks on same axis
// ---------------------------------------------------------------------------

describe('AB-6 two breaks on same axis', () => {
  it('T2.8 AB-6: 3 surviving fragments with cumulative shift', () => {
    const BBOX = { minX: 0, minY: -5, maxX: 350, maxY: 5 };
    const e: Edge2D = { id: 'longEdge', kind: 'outline', points: [[0,0],[350,0]] };
    const breaks: BreakRegion[] = [
      { id: 'b1', axis: 'x', coordA: 50,  coordB: 100, gapMm: 5, style: 'zigzag' },
      { id: 'b2', axis: 'x', coordA: 200, coordB: 300, gapMm: 5, style: 'zigzag' },
    ];
    const { edges, breakSymbolEdges } = applyBreaks([e], breaks, BBOX);

    expect(edges).toHaveLength(3);
    expect(breakSymbolEdges).toHaveLength(2);

    // Fragment 1: [(0,0),(50,0)] — before break1, no shift
    const frag1 = edges.find(e => e.points[0]![0] < 1 && e.points[1]![0] <= 51);
    expect(frag1).toBeDefined();
    expect(frag1!.points[0]![0]).toBeCloseTo(0, 5);
    expect(frag1!.points[1]![0]).toBeCloseTo(50, 5);

    // Fragment 2: between the two bands; in original space [(100,0),(200,0)]
    // After break1 shift=−45: [(55,0),(155,0)]
    const frag2 = edges.find(e => e.points[0]![0] > 50 && e.points[0]![0] < 160);
    expect(frag2).toBeDefined();
    expect(frag2!.points[0]![0]).toBeCloseTo(55, 5);
    expect(frag2!.points[1]![0]).toBeCloseTo(155, 5);

    // Fragment 3: original [(305,0),(350,0)] after total shift=−140: [(165,0),(210,0)]
    // Note: spec says 165,210 → the edge after coordB2=300 starts at 305 per AB-6 spec note
    const frag3 = edges.find(e => e.points[1]![0] > 200);
    expect(frag3).toBeDefined();
    expect(frag3!.points[1]![0]).toBeCloseTo(210, 5);
  });
});

// ---------------------------------------------------------------------------
// T2.9 — AB-7: y-axis break
// ---------------------------------------------------------------------------

describe('AB-7 y-axis break', () => {
  it('T2.9 AB-7: vertical edge with y-axis break → two fragments', () => {
    const BBOX = { minX: -5, minY: 0, maxX: 5, maxY: 200 };
    const e: Edge2D = { id: 'vedge', kind: 'outline', points: [[0,0],[0,200]] };
    const br: BreakRegion = { id: 'by', axis: 'y', coordA: 30, coordB: 80, gapMm: 5, style: 'zigzag' };
    const { edges, breakSymbolEdges } = applyBreaks([e], [br], BBOX);

    // shift = −(80−30−5) = −45
    expect(edges).toHaveLength(2);
    const a = edges.find(e => e.id === 'vedge_a');
    const b = edges.find(e => e.id === 'vedge_b');
    expect(a).toBeDefined();
    expect(b).toBeDefined();

    // Before fragment: y from 0 to 30
    expect(a!.points[0]).toEqual([0, 0]);
    expect(a!.points[1]![1]).toBeCloseTo(30, 5);

    // After fragment: y from 80−45=35 to 200−45=155
    expect(b!.points[0]![1]).toBeCloseTo(35, 5);
    expect(b!.points[1]![1]).toBeCloseTo(155, 5);
    // x unchanged
    expect(b!.points[0]![0]).toBeCloseTo(0, 5);

    // Symbol: axis='y', spine runs along X
    expect(breakSymbolEdges).toHaveLength(1);
    expect(breakSymbolEdges[0]!.kind).toBe('break');
    // spine_pos = coordA + gapMm = 30 + 5 = 35
    const yCoords = breakSymbolEdges[0]!.points.map(p => p[1]);
    yCoords.forEach(y => {
      expect(Math.abs(y - 35)).toBeLessThanOrEqual(1.5 + 1e-9);
    });
  });
});

// ---------------------------------------------------------------------------
// T2.10 — AB-8: empty edges array
// ---------------------------------------------------------------------------

describe('AB-8 empty edges array', () => {
  it('T2.10 AB-8: symbol emitted even with no geometry edges', () => {
    const BBOX = { minX: 0, minY: 0, maxX: 300, maxY: 60 };
    const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };
    const { edges, breakSymbolEdges } = applyBreaks([], [br], BBOX);
    expect(edges).toHaveLength(0);
    expect(breakSymbolEdges).toHaveLength(1);
    expect(breakSymbolEdges[0]!.kind).toBe('break');
  });
});

// ---------------------------------------------------------------------------
// T2.11 — AB-9: break symbol geometry detail
// ---------------------------------------------------------------------------

describe('AB-9 break symbol geometry', () => {
  it('T2.11 AB-9: zigzag spine, span, and point count', () => {
    const BBOX = { minX: 0, minY: 0, maxX: 300, maxY: 60 };
    const br: BreakRegion = { id: 'b9', axis: 'x', coordA: 100, coordB: 200, gapMm: 5, style: 'zigzag' };
    const { breakSymbolEdges } = applyBreaks([], [br], BBOX);
    expect(breakSymbolEdges).toHaveLength(1);
    const sym = breakSymbolEdges[0]!;

    // spine at x=105 (coordA + gapMm = 100 + 5 = 105)
    const xCoords = sym.points.map(p => p[0]);
    xCoords.forEach(x => {
      expect(Math.abs(x - 105)).toBeLessThanOrEqual(1.5 + 1e-9);
    });

    // Y span: perpMin = minY − 5 = −5; perpMax = maxY + 5 = 65
    const yCoords = sym.points.map(p => p[1]);
    expect(Math.min(...yCoords)).toBeCloseTo(-5, 1);
    expect(Math.max(...yCoords)).toBeCloseTo(65, 1);

    // Point count: perpSpan = 65 − (−5) = 70; floor(70/3) = 23; 23×4 + 1 = 93 points
    expect(sym.points.length).toBeGreaterThanOrEqual(4 * Math.floor(70 / 3));
    expect(sym.points.length).toBeLessThanOrEqual(4 * Math.floor(70 / 3) + 8);
  });
});

// ---------------------------------------------------------------------------
// T2.12 — AB-10: hidden-edge array same id-stability
// ---------------------------------------------------------------------------

describe('AB-10 y-axis break — visible and hidden arrays identical semantics', () => {
  it('T2.12 AB-10: hidden edges processed same as visible edges', () => {
    const BBOX = { minX: -5, minY: 0, maxX: 5, maxY: 200 };
    const visEdge: Edge2D = { id: 'vis1', kind: 'silhouette', points: [[0,0],[0,200]] };
    const hidEdge: Edge2D = { id: 'hid1', kind: 'feature',    points: [[0,0],[0,200]] };
    const br: BreakRegion = { id: 'by', axis: 'y', coordA: 50, coordB: 150, gapMm: 5, style: 'zigzag' };

    const visResult = applyBreaks([visEdge], [br], BBOX);
    const hidResult = applyBreaks([hidEdge], [br], BBOX);

    // Both produce 2 fragments
    expect(visResult.edges).toHaveLength(2);
    expect(hidResult.edges).toHaveLength(2);

    // Id-stability: _a and _b suffixes on both
    expect(visResult.edges.find(e => e.id === 'vis1_a')).toBeDefined();
    expect(visResult.edges.find(e => e.id === 'vis1_b')).toBeDefined();
    expect(hidResult.edges.find(e => e.id === 'hid1_a')).toBeDefined();
    expect(hidResult.edges.find(e => e.id === 'hid1_b')).toBeDefined();

    // After-fragments translated identically: shift = −(150−50−5) = −95
    const visFrag = visResult.edges.find(e => e.id === 'vis1_b')!;
    const hidFrag = hidResult.edges.find(e => e.id === 'hid1_b')!;
    expect(visFrag.points[0]![1]).toBeCloseTo(hidFrag.points[0]![1], 5);

    // Break symbol emitted for both calls
    expect(visResult.breakSymbolEdges).toHaveLength(1);
    expect(hidResult.breakSymbolEdges).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// T2.13 — spec §7.4 edge cases
// ---------------------------------------------------------------------------

describe('applyBreaks — spec §7.4 edge cases', () => {
  const BBOX = { minX: 0, minY: -5, maxX: 200, maxY: 5 };
  const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };

  it('T2.13a zero-length edge before band → kept', () => {
    const e: Edge2D = { id: 'zl', kind: 'outline', points: [[30,0],[30,0]] };
    const { edges } = applyBreaks([e], [br], BBOX);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.id).toBe('zl');
  });

  it('T2.13b zero-length edge inside band → dropped', () => {
    const e: Edge2D = { id: 'zl_in', kind: 'outline', points: [[70,0],[70,0]] };
    const { edges } = applyBreaks([e], [br], BBOX);
    expect(edges).toHaveLength(0);
  });

  it('T2.13c edge tangent to coordB → kept as "after" translated, id unchanged', () => {
    // §7.4 case 6: edge at exactly coordB treated as start of "after" zone
    const e: Edge2D = { id: 'e_cb', kind: 'outline', points: [[100,0],[100,10]] };
    const { edges } = applyBreaks([e], [br], BBOX);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.id).toBe('e_cb');
    // Translated: shift = −45; 100−45 = 55
    expect(edges[0]!.points[0]![0]).toBeCloseTo(55, 5);
  });

  it('T2.13d edge crosses coordA only → _a suffix on before fragment', () => {
    // §7.4 case 7: before fragment only; inside portion dropped
    const e: Edge2D = { id: 'e_ca', kind: 'outline', points: [[30,0],[80,0]] };
    const { edges } = applyBreaks([e], [br], BBOX);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.id).toBe('e_ca_a');
    expect(edges[0]!.points[1]![0]).toBeCloseTo(50, 5);
  });

  it('T2.13e edge crosses coordB only → _b suffix on after fragment (translated)', () => {
    // §7.4 case 8: inside portion dropped; after fragment
    const e: Edge2D = { id: 'e_cbx', kind: 'outline', points: [[80,0],[160,0]] };
    const { edges } = applyBreaks([e], [br], BBOX);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.id).toBe('e_cbx_b');
    // After fragment: from coordB=100, translated: 100−45=55; end: 160−45=115
    expect(edges[0]!.points[0]![0]).toBeCloseTo(55, 5);
    expect(edges[0]!.points[1]![0]).toBeCloseTo(115, 5);
  });
});

// ---------------------------------------------------------------------------
// T2.14 — edge id stability (spec §7.2 step 3 + spec §10)
// ---------------------------------------------------------------------------

describe('applyBreaks — edge id stability (spec §10)', () => {
  const BBOX = { minX: 0, minY: -5, maxX: 200, maxY: 5 };
  const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };

  it('T2.14a edge entirely outside band — id unchanged (no suffix)', () => {
    const e: Edge2D = { id: 'pure_before', kind: 'outline', points: [[0,0],[30,0]] };
    const { edges } = applyBreaks([e], [br], BBOX);
    expect(edges[0]!.id).toBe('pure_before'); // no _a suffix
  });

  it('T2.14b edge spanning band → both halves get _a and _b', () => {
    const e: Edge2D = { id: 'e1', kind: 'outline', points: [[0,0],[200,0]] };
    const { edges } = applyBreaks([e], [br], BBOX);
    const ids = edges.map(e => e.id).sort();
    expect(ids).toContain('e1_a');
    expect(ids).toContain('e1_b');
    expect(ids).not.toContain('e1'); // unsuffixed form must NOT appear
  });

  it('T2.14c kind and sourceFaceIds preserved on surviving fragments', () => {
    const e: Edge2D = {
      id: 'ef',
      kind: 'silhouette',
      points: [[0,0],[200,0]],
      sourceFaceIds: ['face_A', 'face_B'],
    };
    const { edges } = applyBreaks([e], [br], BBOX);
    edges.forEach(frag => {
      expect(frag.kind).toBe('silhouette');
      expect(frag.sourceFaceIds).toEqual(['face_A', 'face_B']);
    });
  });
});

// ---------------------------------------------------------------------------
// T2.15 — fingerprintBreaksArray (from fingerprint.ts, tested in separate spec)
// These tests are in fingerprintBreaksArray.spec.ts; here we just reference T2.15 tasks
// ---------------------------------------------------------------------------

// T2.15 tests live in fingerprintBreaksArray.spec.ts (already covers all T2.15 cases)

// ---------------------------------------------------------------------------
// T2.16 — §8.2 integration / composition pattern
// ---------------------------------------------------------------------------

import { fingerprintBreaksArray } from '../fingerprint';

describe('fingerprintBreaksArray — §8.2 integration with inputFingerprint pattern', () => {
  it('T2.16a same view fingerprint + same breaks → same composed fingerprint', () => {
    const breaks: BreakRegion[] = [
      { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' },
    ];
    const fp1 = fingerprintBreaksArray(breaks);
    const fp2 = fingerprintBreaksArray(breaks);
    expect(fp1).toBe(fp2);
  });

  it('T2.16b different breaks array → different fingerprintBreaksArray output', () => {
    const b1: BreakRegion = { id: 'x', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };
    const b2: BreakRegion = { id: 'y', axis: 'x', coordA: 60, coordB: 100, gapMm: 5, style: 'zigzag' };
    expect(fingerprintBreaksArray([b1])).not.toBe(fingerprintBreaksArray([b2]));
  });
});
