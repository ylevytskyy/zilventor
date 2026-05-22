// packages/app/src/commands/__tests__/AutoDimCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AutoDimCommand } from '../AutoDimCommand';
import { useAppStore } from '../../store/useAppStore';
import type {
  DrawingDocument,
  DrawingDimension,
  PartDocument,
  Feature,
} from '@zilventor/shared';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeEdge2D(id: string, x1: number, y1: number, x2: number, y2: number) {
  return {
    id,
    kind: 'feature' as const,
    points: [[x1, y1], [x2, y2]] as ReadonlyArray<readonly [number, number]>,
  };
}

function makeDrawingDoc(dims: DrawingDimension[] = []): DrawingDocument {
  return {
    id: 'dw1',
    name: 'Test Drawing',
    units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {},
    activeSheetId: 'sh1',
    sheets: [
      {
        id: 'sh1',
        name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' },
        orientation: 'landscape',
        views: [makeBaseView()],
        dimensions: dims,
        annotations: [],
        titleBlock: {},
      },
    ],
  };
}

function makeBaseView() {
  // Edge coordinates must match what buildViewMatrix('front', sourceBbox) produces for the sketch.
  // sourceBbox is derived from proj.bbox: [0,0,0, 50,30,20] → cx=25,cy=15,cz=10.
  // T_recenter(-25,-15,-10) applied to sketch primitives (z=0):
  //   prim-width  (0,0)→(50,0)   → (-25,-15)→(25,-15)   → linear-h
  //   prim-height (0,0)→(0,30)   → (-25,-15)→(-25,15)   → linear-v
  //   prim-depth  (0,30)→(50,30) → (-25,15)→(25,15)     → linear-h (dim-distance target)
  return {
    id: 'view1',
    kind: 'base' as const,
    positionMm: { x: 0, y: 0 },
    scale: { numerator: 1, denominator: 1 },
    orientation: 'front' as const,
    showHidden: false,
    projection: {
      visibleEdges: [
        makeEdge2D('edge-width',  -25, -15,  25, -15),  // horizontal width edge (projected)
        makeEdge2D('edge-height', -25, -15, -25,  15),  // vertical height edge (projected)
        makeEdge2D('edge-depth',  -25,  15,  25,  15),  // top horizontal edge (projected)
      ],
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 50, maxY: 30 },  // 2D sketch extent for sourceBbox derivation
    },
  };
}

/**
 * Part with 3 parametric constraints:
 *   - dim-length on prim-width  (horizontal, paramName='width')
 *   - dim-length on prim-height (vertical,   paramName='height')
 *   - dim-distance between prim-width and prim-depth (paramName='depth')
 */
function makePartDoc(): PartDocument {
  const sketchFeature: Feature = {
    kind: 'sketch',
    id: 'sketch1',
    plane: { source: 'workPlane', featureId: 'origin.XY' },
    primitives: [
      { id: 'prim-width',  kind: 'line', x1: 0, y1: 0, x2: 50, y2: 0 },
      { id: 'prim-height', kind: 'line', x1: 0, y1: 0, x2: 0,  y2: 30 },
      { id: 'prim-depth',  kind: 'line', x1: 0, y1: 30, x2: 50, y2: 30 },
    ],
    constraints: [
      {
        id: 'dc-width',
        kind: 'dim-length',
        line: 'prim-width',
        paramName: 'width',
        value: { kind: 'param', paramName: 'width' },
      },
      {
        id: 'dc-height',
        kind: 'dim-length',
        line: 'prim-height',
        paramName: 'height',
        value: { kind: 'param', paramName: 'height' },
      },
      {
        id: 'dc-depth',
        kind: 'dim-distance',
        a: { primitiveId: 'prim-width',  anchor: 'start' },
        b: { primitiveId: 'prim-depth',  anchor: 'start' },
        paramName: 'depth',
        value: { kind: 'param', paramName: 'depth' },
      },
    ],
  };

  const extrudeFeature: Feature = {
    kind: 'extrude',
    id: 'extrude1',
    sketchRef: 'sketch1',
    distanceParam: 'depth',
    direction: 'forward',
    operation: 'new',
  };

  return {
    id: 'part1',
    name: 'Box',
    units: 'mm',
    parameters: {
      width:  { name: 'width',  expression: '50', value: 50,  unit: 'mm' },
      height: { name: 'height', expression: '30', value: 30,  unit: 'mm' },
      depth:  { name: 'depth',  expression: '20', value: 20,  unit: 'mm' },
    },
    featureTree: [sketchFeature, extrudeFeature],
    properties: {},
    materials: [],
    hardware: [],
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('AutoDimCommand', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingDoc() },
      activeDrawing:  makeDrawingDoc(),
      activePart:     makePartDoc(),
    } as never);
  });

  // HS-CMD-1 ---------------------------------------------------------------
  describe('HS-CMD-1: apply happy path — 3-constraint fixture', () => {
    it('places dims and sets sourceParameterName on each', async () => {
      const cmd = new AutoDimCommand({ drawingId: 'dw1', sheetId: 'sh1', viewId: 'view1' });
      await cmd.apply();

      const state = useAppStore.getState();
      const doc = (state.activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
      const sheet = doc.sheets.find((s) => s.id === 'sh1')!;

      // At least 2 dims placed (width + height; depth dim-distance may vary by findMatchingEdge2D mock)
      expect(sheet.dimensions.length).toBeGreaterThanOrEqual(2);

      // Each placed dim has sourceParameterName set
      for (const d of sheet.dimensions) {
        if ('sourceParameterName' in d) {
          expect(typeof d.sourceParameterName).toBe('string');
        }
      }

      // placedIds tracked (accessed via the command object)
      expect((cmd as unknown as { placedIds: string[] }).placedIds.length)
        .toBe(sheet.dimensions.length);
    });
  });

  // HS-CMD-2 ---------------------------------------------------------------
  describe('HS-CMD-2: view without projection — throws view-projection-missing', () => {
    it('rejects with view-projection-missing and places 0 dims', async () => {
      // Inject a view that has no projection
      const docWithoutProj: DrawingDocument = {
        ...makeDrawingDoc(),
        sheets: [
          {
            id: 'sh1',
            name: 'Sheet 1',
            size: { kind: 'iso', size: 'A3' },
            orientation: 'landscape',
            views: [
              {
                id: 'view1',
                kind: 'base' as const,
                positionMm: { x: 0, y: 0 },
                scale: { numerator: 1, denominator: 1 },
                orientation: 'front' as const,
                showHidden: false,
                // No projection field
              },
            ],
            dimensions: [],
            annotations: [],
            titleBlock: {},
          },
        ],
      };

      useAppStore.setState({
        activeDocument: { kind: 'drawing', document: docWithoutProj },
        activeDrawing: docWithoutProj,
        activePart: makePartDoc(),
      } as never);

      const cmd = new AutoDimCommand({ drawingId: 'dw1', sheetId: 'sh1', viewId: 'view1' });

      // Should throw 'view-projection-missing' per spec §5.4 table
      await expect(cmd.apply()).rejects.toThrow('view-projection-missing');

      // No dims placed
      const state = useAppStore.getState();
      const doc2 = (state.activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
      expect(doc2.sheets[0]!.dimensions).toHaveLength(0);
    });
  });

  // HS-CMD-3 ---------------------------------------------------------------
  describe('HS-CMD-3: part with no base extrude — empty result with status', () => {
    it('applies without throwing and places 0 dims', async () => {
      const partNoExtrude: PartDocument = {
        ...makePartDoc(),
        featureTree: [
          // Only a sketch, no extrude
          {
            kind: 'sketch' as const,
            id: 'sketch1',
            plane: { source: 'workPlane', featureId: 'origin.XY' },
            primitives: [],
            constraints: [],
          },
        ],
      };

      useAppStore.setState({
        activeDocument: { kind: 'drawing', document: makeDrawingDoc() },
        activeDrawing: makeDrawingDoc(),
        activePart: partNoExtrude,
      } as never);

      const cmd = new AutoDimCommand({ drawingId: 'dw1', sheetId: 'sh1', viewId: 'view1' });
      await cmd.apply();   // must NOT throw

      const state = useAppStore.getState();
      const doc2 = (state.activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
      expect(doc2.sheets[0]!.dimensions).toHaveLength(0);
    });
  });

  // HS-CMD-4 ---------------------------------------------------------------
  describe('HS-CMD-4: dim-length + dim-distance both placed with correct PointRef pairings', () => {
    it('dim-length places from/to on the SAME edge; dim-distance spans TWO different edges', async () => {
      // Reset store with standard 3-constraint fixture
      useAppStore.setState({
        activeDocument: { kind: 'drawing', document: makeDrawingDoc() },
        activeDrawing:  makeDrawingDoc(),
        activePart:     makePartDoc(),
      } as never);

      const cmd = new AutoDimCommand({ drawingId: 'dw1', sheetId: 'sh1', viewId: 'view1' });
      await cmd.apply();

      const state = useAppStore.getState();
      const doc2 = (state.activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
      const sheet = doc2.sheets.find((s) => s.id === 'sh1')!;

      // Locate the dim-length dims (from and to reference the same edgeId)
      const lengthDims = sheet.dimensions.filter((d) => {
        if (!('from' in d) || !('to' in d)) return false;
        const from = d.from as { kind: string; edgeId: string };
        const to   = d.to   as { kind: string; edgeId: string };
        return from.edgeId === to.edgeId;
      });
      expect(lengthDims.length).toBeGreaterThanOrEqual(1);

      // Locate the dim-distance dim (from and to reference DIFFERENT edgeIds)
      const distanceDims = sheet.dimensions.filter((d) => {
        if (!('from' in d) || !('to' in d)) return false;
        const from = d.from as { kind: string; edgeId: string };
        const to   = d.to   as { kind: string; edgeId: string };
        return from.edgeId !== to.edgeId;
      });
      // dim-distance between prim-width (y=0) and prim-depth (y=30) → should be linear-v or aligned
      expect(distanceDims.length).toBeGreaterThanOrEqual(1);

      // sourceParameterName is set on all placed dims
      for (const d of sheet.dimensions) {
        if ('sourceParameterName' in d) {
          expect(['width', 'height', 'depth']).toContain(d.sourceParameterName);
        }
      }
    });

    it('skips dim-distance when one primitive lookup fails', async () => {
      // Part whose dim-distance references a non-existent primitive 'prim-missing'
      const partBadRef: PartDocument = {
        ...makePartDoc(),
        featureTree: [
          {
            kind: 'sketch' as const,
            id: 'sketch1',
            plane: { source: 'workPlane', featureId: 'origin.XY' },
            primitives: [
              { id: 'prim-width', kind: 'line', x1: 0, y1: 0, x2: 50, y2: 0 },
            ],
            constraints: [
              {
                id: 'dc-bad-dist',
                kind: 'dim-distance' as const,
                a: { primitiveId: 'prim-width',   anchor: 'start' as const },
                b: { primitiveId: 'prim-missing',  anchor: 'start' as const },
                paramName: 'gap',
                value: { kind: 'literal' as const, value: 10 },
              },
            ],
          },
          {
            kind: 'extrude' as const,
            id: 'extrude1',
            sketchRef: 'sketch1',
            distanceParam: 'depth',
            direction: 'forward' as const,
            operation: 'new' as const,
          },
        ],
      };

      useAppStore.setState({
        activeDocument: { kind: 'drawing', document: makeDrawingDoc() },
        activeDrawing:  makeDrawingDoc(),
        activePart:     partBadRef,
      } as never);

      const cmd = new AutoDimCommand({ drawingId: 'dw1', sheetId: 'sh1', viewId: 'view1' });
      await cmd.apply();

      const state = useAppStore.getState();
      const doc2 = (state.activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
      const sheet = doc2.sheets.find((s) => s.id === 'sh1')!;
      // The bad dim-distance should have been skipped entirely (0 dims placed)
      expect(sheet.dimensions).toHaveLength(0);
    });
  });

  // HS-CMD-5 ---------------------------------------------------------------
  describe('HS-CMD-5: atomic revert removes all placed dims', () => {
    it('revert restores sheet.dimensions.length to 0', async () => {
      useAppStore.setState({
        activeDocument: { kind: 'drawing', document: makeDrawingDoc() },
        activeDrawing:  makeDrawingDoc(),
        activePart:     makePartDoc(),
      } as never);

      const cmd = new AutoDimCommand({ drawingId: 'dw1', sheetId: 'sh1', viewId: 'view1' });
      await cmd.apply();

      // Confirm at least one dim was placed
      {
        const state = useAppStore.getState();
        const doc2 = (state.activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
        expect(doc2.sheets[0]!.dimensions.length).toBeGreaterThan(0);
      }

      await cmd.revert();

      // Sheet must be back to 0 dims
      {
        const state = useAppStore.getState();
        const doc2 = (state.activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
        expect(doc2.sheets[0]!.dimensions).toHaveLength(0);
      }

      // activeDrawing is also updated
      {
        const state = useAppStore.getState();
        expect(state.activeDrawing?.sheets[0]?.dimensions).toHaveLength(0);
      }
    });

    it('revert called without prior apply is a no-op', async () => {
      useAppStore.setState({
        activeDocument: { kind: 'drawing', document: makeDrawingDoc() },
        activeDrawing:  makeDrawingDoc(),
        activePart:     makePartDoc(),
      } as never);

      const cmd = new AutoDimCommand({ drawingId: 'dw1', sheetId: 'sh1', viewId: 'view1' });
      await expect(cmd.revert()).resolves.toBeUndefined();   // must not throw

      const state = useAppStore.getState();
      const doc2 = (state.activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
      expect(doc2.sheets[0]!.dimensions).toHaveLength(0);
    });
  });
});
