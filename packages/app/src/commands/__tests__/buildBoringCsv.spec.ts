import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { buildBoringCsv } from '../buildBoringCsv';
import type { BoringAggregateResult } from '../../assembly/walkers/aggregateBoresRecursive';
import type { BoreOp } from '@zilventor/shared';

const bore = (over: Partial<BoreOp> = {}): BoreOp => ({
  id: 'b1', face: { featureId: 'panel', role: 'Top', instance: 0 }, u: 100, v: 50, diameter: 5, depth: 34,
  role: 'confirmat-face', connectorId: 'k1', connectorKind: 'confirmat', ...over,
});

const empty: BoringAggregateResult = { panels: [] };

describe('buildBoringCsv', () => {
  it('emits the header for an empty result — includes Length,Width,Thickness', () => {
    const csv = buildBoringCsv(empty);
    expect(csv).toContain('Panel,Length,Width,Thickness,Tag,Face,X,Y,Ø,Depth,Type');
  });

  it('emits one row per bore with X=u, Y=v, Ø=diameter, numeric depth', () => {
    const result: BoringAggregateResult = {
      panels: [{
        partPath: 'parts/side.zipt', partName: 'Side', qty: 2,
        length: 600, width: 400, thickness: 18,
        componentPathKeys: [],
        bores: [bore({ id: 'b1' }), bore({ id: 'b2', u: 200, diameter: 8 })],
      }],
    };
    const csv = buildBoringCsv(result);
    expect(csv).toContain('Side,600,400,18,b1,Top,100,50,5,34,confirmat');
    expect(csv).toContain('Side,600,400,18,b2,Top,200,50,8,34,confirmat');
  });

  it("renders depth 'throughAll' as THROUGH", () => {
    const result: BoringAggregateResult = {
      panels: [{
        partPath: 'p.zipt', partName: 'Back', qty: 1,
        length: 300, width: 200, thickness: 16,
        componentPathKeys: [],
        bores: [bore({ id: 'b9', face: { featureId: 'panel', role: 'Back', instance: 0 }, depth: 'throughAll' })],
      }],
    };
    const csv = buildBoringCsv(result);
    expect(csv).toContain('Back,300,200,16,b9,Back,100,50,5,THROUGH,confirmat');
  });

  it('RFC-4180 quotes a panel name containing a comma', () => {
    const result: BoringAggregateResult = {
      panels: [{
        partPath: 'p.zipt', partName: 'Side, left', qty: 1,
        length: null, width: null, thickness: null,
        componentPathKeys: [],
        bores: [bore()],
      }],
    };
    const csv = buildBoringCsv(result);
    // panel name quoted, then 3 empty dim cells, then bore fields
    expect(csv).toContain('"Side, left",,,,b1,Top,100,50,5,34,confirmat');
  });

  it('emits empty cells for null dims (unresolvable panel spec)', () => {
    const result: BoringAggregateResult = {
      panels: [{
        partPath: 'p.zipt', partName: 'Panel', qty: 1,
        length: null, width: null, thickness: null,
        componentPathKeys: [],
        bores: [bore()],
      }],
    };
    const csv = buildBoringCsv(result);
    // Header has Length/Width/Thickness; data row has three empty cells after panel name.
    expect(csv).toContain('Panel,Length,Width,Thickness,Tag,Face,X,Y,Ø,Depth,Type');
    // panel name + 3 empty dim cells (Length,,Width,,Thickness,) then bore fields
    expect(csv).toContain('Panel,,,,b1,Top,100,50,5,34,confirmat');
  });

  it('emits populated Length/Width/Thickness cells when dims are provided', () => {
    const result: BoringAggregateResult = {
      panels: [{
        partPath: 'p.zipt', partName: 'Side', qty: 1,
        length: 800, width: 600, thickness: 18,
        componentPathKeys: [],
        bores: [bore()],
      }],
    };
    const csv = buildBoringCsv(result);
    expect(csv).toContain('Side,800,600,18,b1,Top,100,50,5,34,confirmat');
  });
});

// ── Golden snapshot: representative fixture with known dims + two bores ────────────────────────
describe('buildBoringCsv — golden snapshot', () => {
  const goldenResult: BoringAggregateResult = {
    panels: [
      {
        partPath: 'cabinet/side.zipt',
        partName: 'Side Panel',
        qty: 2,
        length: 720,
        width: 560,
        thickness: 18,
        componentPathKeys: [],
        bores: [
          bore({ id: 'b1', u: 37, v: 96, diameter: 5, depth: 34 }),
          bore({ id: 'b2', u: 37, v: 192, diameter: 5, depth: 34 }),
          bore({ id: 'b3', u: 37, v: 288, diameter: 8, depth: 'throughAll' }),
        ],
      },
      {
        partPath: 'cabinet/back.zipt',
        partName: 'Back',
        qty: 1,
        length: null,
        width: null,
        thickness: null,
        componentPathKeys: [],
        bores: [bore({ id: 'b4', u: 50, v: 100, diameter: 5, depth: 12 })],
      },
    ],
  };

  it('matches CSV golden snapshot', async () => {
    const csv = buildBoringCsv(goldenResult);
    await expect(csv).toMatchFileSnapshot(
      path.join(__dirname, '__snapshots__', 'buildBoringCsv.csv'),
    );
  });
});
