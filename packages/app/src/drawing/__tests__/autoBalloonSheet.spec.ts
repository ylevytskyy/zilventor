// packages/app/src/drawing/__tests__/autoBalloonSheet.spec.ts
// Task 6 — autoBalloonSheet: one balloon per parts-list row, anchored to bbox center in sheet space.
//
// Fixture design:
//   - Assembly with 2 unique parts (item 1 = c1 → parts/box.zipt, item 2 = c2 → parts/shelf.zipt)
//   - One view at positionMm {x:50, y:50}, scale 1:1
//   - Component 1 edges span view-local x[0..10] y[0..10] → center (5,5) → sheet (55,55)
//   - Component 2 edges span view-local x[20..40] y[20..40] → center (30,30) → sheet (80,80)
//   - pathKey(['c1']) === 'c1', pathKey(['c2']) === 'c2' (single-segment, separator is ' ')

import { describe, it, expect } from 'vitest';
import type { AssemblyDocument, PartInfo } from '@zilventor/shared';
import type { DrawingSheet } from '@zilventor/shared';
import { autoBalloonSheet } from '../autoBalloonSheet';

function makeAssembly(): AssemblyDocument {
  return {
    id: 'asm1',
    name: 'Test Assembly',
    units: 'mm',
    parameters: {},
    constraints: [],
    groundedComponentPaths: [],
    colors: {},
    // Pre-assign item numbers so the order is deterministic
    bomItemNumbers: {
      'parts/box.zipt::none': 1,
      'parts/shelf.zipt::none': 2,
    },
    cutListItemNumbers: {},
    colorOverrides: {},
    properties: {},
    materials: [],
    hardware: [],
    components: [
      {
        id: 'c1',
        partPath: 'parts/box.zipt',
        position: { x: 0, y: 0, z: 0 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
      },
      {
        id: 'c2',
        partPath: 'parts/shelf.zipt',
        position: { x: 0, y: 300, z: 0 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
      },
    ],
  };
}

function makePartInfo(): Map<string, PartInfo> {
  return new Map([
    ['parts/box.zipt', { name: 'Box', path: 'parts/box.zipt' }],
    ['parts/shelf.zipt', { name: 'Shelf', path: 'parts/shelf.zipt' }],
  ]);
}

// pathKey(['c1']) === 'c1' (single-segment, PATH_SEPARATOR = ' ')
// pathKey(['c2']) === 'c2'
function makeSheet(): DrawingSheet {
  return {
    id: 's1',
    name: 'Sheet 1',
    size: { kind: 'iso', size: 'A3' },
    orientation: 'landscape',
    views: [
      {
        id: 'v1',
        kind: 'base' as const,
        positionMm: { x: 50, y: 50 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front' as const,
        showHidden: false,
        projection: {
          visibleEdges: [
            {
              // Component 1: spans view-local [0..10] x [0..10] → bbox center (5,5)
              id: 'e1',
              kind: 'feature' as const,
              points: [
                [0, 0],
                [10, 0],
                [10, 10],
                [0, 10],
              ] as ReadonlyArray<readonly [number, number]>,
              componentPath: 'c1',
            },
            {
              // Component 2: spans view-local [20..40] x [20..40] → bbox center (30,30)
              id: 'e2',
              kind: 'feature' as const,
              points: [
                [20, 20],
                [40, 20],
                [40, 40],
                [20, 40],
              ] as ReadonlyArray<readonly [number, number]>,
              componentPath: 'c2',
            },
          ],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
        },
      },
    ],
    dimensions: [],
    annotations: [],
    titleBlock: {},
    dimensionGroups: [],
  };
}

const ARGS = {
  sheet: makeSheet(),
  asm: makeAssembly(),
  cache: { get: (_p: string) => undefined } as { get: (p: string) => { kind: 'ok'; doc: AssemblyDocument; partPath: string } | undefined },
  partInfo: makePartInfo(),
  panelSpecs: new Map<string, null>(),
};

describe('autoBalloonSheet', () => {
  it('produces one balloon per parts-list row with correct item numbers', () => {
    const balloons = autoBalloonSheet(ARGS);
    expect(balloons).toHaveLength(2);
    expect(new Set(balloons.map((b) => b.itemNumber))).toEqual(new Set([1, 2]));
    for (const b of balloons) expect(b.kind).toBe('balloon');
  });

  it('anchors targetMm to the component bbox center in sheet space', () => {
    const balloons = autoBalloonSheet(ARGS);
    const b1 = balloons.find((b) => b.itemNumber === 1)!;
    // component 1 edges span view-local x[0..10] y[0..10] → center (5,5);
    // sheet = positionMm(50,50) + center * scale(1) = (55, 55)
    expect(b1.targetMm).toEqual({ x: 55, y: 55 });

    const b2 = balloons.find((b) => b.itemNumber === 2)!;
    // component 2 edges span view-local x[20..40] y[20..40] → center (30,30);
    // sheet = positionMm(50,50) + center * scale(1) = (80, 80)
    expect(b2.targetMm).toEqual({ x: 80, y: 80 });
  });

  it('ladders text positions so balloons do not overlap', () => {
    const balloons = autoBalloonSheet(ARGS);
    const ys = balloons.map((b) => b.textPosMm.y);
    expect(new Set(ys).size).toBe(ys.length); // all distinct
  });

  it('all balloons reference a valid viewId', () => {
    const balloons = autoBalloonSheet(ARGS);
    for (const b of balloons) {
      expect(b.viewId).toBe('v1');
    }
  });

  it('returns empty array when no views have projections', () => {
    const sheet: DrawingSheet = {
      ...makeSheet(),
      views: [
        {
          id: 'v-empty',
          kind: 'base' as const,
          positionMm: { x: 0, y: 0 },
          scale: { numerator: 1, denominator: 1 },
          orientation: 'front' as const,
          showHidden: false,
          // no projection
        },
      ],
    };
    const result = autoBalloonSheet({ ...ARGS, sheet });
    expect(result).toHaveLength(0);
  });
});
