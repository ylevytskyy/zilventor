import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { renderBoringDxf } from '../renderBoringDxf';
import type { BoringAggregateResult } from '../../assembly/walkers/aggregateBoresRecursive';
import type { BoreOp } from '@zilventor/shared';

function bore(over: Partial<BoreOp>): BoreOp {
  return {
    id: 'b1', face: { featureId: 'panel', role: 'Front', instance: 0 },
    u: 50, v: 100, diameter: 5, depth: 34, role: 'confirmat-face',
    connectorId: 'c1', connectorKind: 'confirmat', ...over,
  };
}

/** Helper: make a BoringPanelGroup with null dims (no PanelSpec). */
function panel(
  path: string,
  name: string,
  bores: BoreOp[],
  dims?: { length: number; width: number; thickness: number },
): BoringAggregateResult['panels'][number] {
  return {
    partPath: path, partName: name, qty: 1, componentPathKeys: ['k'],
    bores,
    length: dims?.length ?? null,
    width: dims?.width ?? null,
    thickness: dims?.thickness ?? null,
  };
}

describe('renderBoringDxf — bore circles', () => {
  it('emits one CIRCLE per bore on a D{Ø}_T{depth} layer', () => {
    const result: BoringAggregateResult = {
      panels: [
        panel('side.zipt', 'Side', [
          bore({ id: 'b1', u: 30, v: 40, diameter: 5, depth: 34 }),
          bore({ id: 'b2', u: 60, v: 80, diameter: 15, depth: 12 }),
          bore({ id: 'b3', u: 90, v: 120, diameter: 8, depth: 'throughAll' }),
        ]),
      ],
    };
    const dxf = renderBoringDxf(result);
    const circleCount = (dxf.match(/\nCIRCLE\n/g) ?? []).length;
    expect(circleCount).toBe(3);
    expect(dxf).toContain('D5_T34');
    expect(dxf).toContain('D15_T12');
    expect(dxf).toContain('D8_THROUGH');
  });

  it('places each circle at the panel-local (u,v) offset by the panel grid origin', () => {
    const result: BoringAggregateResult = {
      panels: [
        panel('a.zipt', 'A', [bore({ id: 'b1', u: 25, v: 35, diameter: 5, depth: 34 })]),
      ],
    };
    const dxf = renderBoringDxf(result);
    // First panel grid origin is x0=0, so the circle center is (25,35), radius 2.5.
    expect(dxf).toMatch(/CIRCLE[\s\S]*?25\.0000[\s\S]*?35\.0000[\s\S]*?2\.5000/);
  });
});

describe('renderBoringDxf — panel outline', () => {
  it('emits an OUTLINE POLYLINE for each panel group', () => {
    const result: BoringAggregateResult = {
      panels: [
        panel('side.zipt', 'Side', [bore({ u: 10, v: 10 }), bore({ id: 'b2', u: 200, v: 400 })]),
      ],
    };
    const dxf = renderBoringDxf(result);
    expect(dxf).toContain('AC1015');               // valid AC1015 header
    expect(dxf).toContain('POLYLINE');
    expect(dxf).toContain('OUTLINE');               // outline layer referenced by the polyline
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
  });

  it('offsets a second panel so its outline does not overlap the first', () => {
    const dxf = renderBoringDxf({
      panels: [
        panel('a.zipt', 'A', [bore({ u: 0, v: 0 }), bore({ id: 'b2', u: 100, v: 100 })]),
        panel('b.zipt', 'B', [bore({ u: 0, v: 0 }), bore({ id: 'b2', u: 100, v: 100 })]),
      ],
    });
    // Two panels → two POLYLINE entities (outline) at minimum.
    const polylineCount = (dxf.match(/\nPOLYLINE\n/g) ?? []).length;
    expect(polylineCount).toBeGreaterThanOrEqual(2);
  });

  it('uses real panel dims (length×width) for the outline when dims are non-null', () => {
    const panelLength = 800;
    const panelWidth = 600;
    const result: BoringAggregateResult = {
      panels: [
        panel('side.zipt', 'Side Panel', [bore({ u: 50, v: 50 })],
          { length: panelLength, width: panelWidth, thickness: 18 }),
      ],
    };
    const dxf = renderBoringDxf(result);
    // The outline POLYLINE should have a vertex at (panelLength, 0) = (800, 0).
    // dxf coords are written as fmt(n) = toFixed(4).
    expect(dxf).toContain('800.0000');
    expect(dxf).toContain('600.0000');
    // And must NOT be bore-span based: bore at u=50, span = 50+50=100 — clearly different from 800.
    // So if the coord 100 appears as outline width it would be wrong; check 800 is there instead.
    expect(dxf).toContain('OUTLINE');
  });

  it('falls back to panelSpan() for the outline when dims are null', () => {
    // Single bore at u=200, v=300 → panelSpan = { w: 200+50, h: 300+50 } = {w:250, h:350}
    const result: BoringAggregateResult = {
      panels: [
        panel('side.zipt', 'Side', [bore({ u: 200, v: 300 })]),
      ],
    };
    const dxf = renderBoringDxf(result);
    // Fallback span: w=250, h=350 should appear in the outline vertices.
    expect(dxf).toContain('250.0000');
    expect(dxf).toContain('350.0000');
    // Should not contain the real-dims values (no dims provided).
    expect(dxf).not.toContain('800.0000');
  });
});

describe('renderBoringDxf — panel label', () => {
  it('emits a TEXT entity containing the panel partName', () => {
    const result: BoringAggregateResult = {
      panels: [
        panel('side.zipt', 'Left Side Panel', [bore({ u: 50, v: 50 })],
          { length: 500, width: 300, thickness: 18 }),
      ],
    };
    const dxf = renderBoringDxf(result);
    expect(dxf).toContain('TEXT');
    expect(dxf).toContain('Left Side Panel');
  });

  it('emits one TEXT entity per panel', () => {
    const panelLength = 400;
    const result: BoringAggregateResult = {
      panels: [
        panel('a.zipt', 'Panel A', [bore({ u: 50, v: 50 })],
          { length: panelLength, width: 300, thickness: 18 }),
        panel('b.zipt', 'Panel B', [bore({ u: 50, v: 50 })],
          { length: panelLength, width: 300, thickness: 18 }),
      ],
    };
    const dxf = renderBoringDxf(result);
    const textCount = (dxf.match(/\nTEXT\n/g) ?? []).length;
    expect(textCount).toBe(2);
    expect(dxf).toContain('Panel A');
    expect(dxf).toContain('Panel B');
    // Second panel's label x = panelLength + PANEL_GAP (50) = 450.
    // A bug placing both labels at x=0 would emit 0.0000 twice and never 450.0000.
    const secondPanelLabelX = (panelLength + 50).toFixed(4); // '450.0000'
    expect(dxf).toContain(secondPanelLabelX);
  });
});

// ── LAYER table declarations: every layer an entity references must also be a declared
// TABLES/LAYER record, not just present on an entity's group-8 code. ─────────────────────────────
/** Raw-text scan of just the TABLE LAYER section's group-2 names (mirrors
 *  renderCombinedManufacturingDxf.spec.ts's layerTableNames helper). */
function layerTableNames(dxf: string): string[] {
  const lines = dxf.split('\n');
  const names: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '  0' && lines[i + 1] === 'LAYER') {
      for (let j = i + 2; j < lines.length; j++) {
        if (lines[j] === '  0') break;
        if (lines[j] === '  2') { names.push(lines[j + 1]!); break; }
      }
    }
  }
  return names;
}

describe('renderBoringDxf — LAYER table declarations', () => {
  it('declares OUTLINE and every dynamic bore layer as LAYER-table records', () => {
    const result: BoringAggregateResult = {
      panels: [
        panel('cabinet/side.zipt', 'Side Panel', [
          bore({ id: 'b1', u: 37, v: 96, diameter: 5, depth: 34 }),
          bore({ id: 'b2', u: 37, v: 288, diameter: 8, depth: 'throughAll' }),
        ], { length: 720, width: 560, thickness: 18 }),
      ],
    };
    const dxf = renderBoringDxf(result);
    const names = layerTableNames(dxf);
    expect(names).toContain('OUTLINE');
    expect(names).toContain('D5_T34');
    expect(names).toContain('D8_THROUGH');
  });
});

// ── Golden snapshot: representative fixture with known dims + two bores ────────────────────────
describe('renderBoringDxf — golden snapshot', () => {
  const goldenPanel = panel(
    'cabinet/side.zipt',
    'Side Panel',
    [
      bore({ id: 'b1', u: 37, v: 96, diameter: 5, depth: 34 }),
      bore({ id: 'b2', u: 37, v: 192, diameter: 5, depth: 34 }),
      bore({ id: 'b3', u: 37, v: 288, diameter: 8, depth: 'throughAll' }),
    ],
    { length: 720, width: 560, thickness: 18 },
  );

  it('matches DXF golden snapshot', async () => {
    const dxf = renderBoringDxf({ panels: [goldenPanel] });
    await expect(dxf).toMatchFileSnapshot(
      path.join(__dirname, '__snapshots__', 'renderBoringDxf.dxf'),
    );
  });
});
