// tests/e2e/helpers/seedDrawing.ts
import type { Page } from '@playwright/test';

export interface SeedDrawingOpts {
  boxLength?: number;
  boxWidth?: number;
  boxHeight?: number;
  sheetSize?: 'A0' | 'A1' | 'A2' | 'A3' | 'A4';
  orientation?: 'landscape' | 'portrait';
}

export interface SeedDrawingWithViewOpts {
  boxLength?: number;
  boxWidth?: number;
  boxHeight?: number;
  orientation?: 'front' | 'top' | 'right' | 'iso-ne';
  scale?: { numerator: number; denominator: number };
}

export interface SeedDrawingResult {
  partDocId: string;
  drawingDocId: string;
  sheetId: string;
  viewId?: string;
}

/**
 * Seeds the store with a minimal DrawingDocument (no views) backed by a stub PartDocument.
 * Uses setState directly to preserve activePart alongside activeDrawing — DrawingCanvas
 * reads activePart for TitleBlock rendering.
 * Returns the document IDs for further test assertions.
 */
export async function seedDrawingWithBoxPart(
  page: Page,
  opts: SeedDrawingOpts = {},
): Promise<SeedDrawingResult> {
  const {
    boxLength = 100, boxWidth = 60, boxHeight = 40,
    sheetSize = 'A3', orientation = 'landscape',
  } = opts;

  const result = await page.evaluate(
    ({ boxLength, boxWidth, boxHeight, sheetSize, orientation }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): unknown;
          setState(partial: unknown): void;
        };
      };

      const partId = `seed-part-${Date.now()}`;
      const part = {
        id: partId,
        name: 'SeedBox',
        units: 'mm',
        parameters: { length: { value: boxLength }, width: { value: boxWidth }, height: { value: boxHeight } },
        featureTree: [],
        properties: {},
        materials: [{ id: 'm1', name: 'Birch', defaultThickness: 18, color: '#c8a96e' }],
        hardware: [],
      };

      const sheetId = `sheet-seed-${Date.now()}`;
      const drawingId = `drawing-seed-${Date.now()}`;
      const drawing = {
        id: drawingId,
        name: 'SeedBox — Drawing',
        units: 'mm',
        source: { partPath: `${partId}.zipt`, sourceKind: 'part' },
        properties: {},
        sheets: [{
          id: sheetId,
          name: 'Sheet 1',
          size: { kind: 'iso', size: sheetSize },
          orientation,
          views: [],
          dimensions: [],
          annotations: [],
          titleBlock: {},
        }],
        activeSheetId: sheetId,
      };

      // Set drawing + keep activePart so DrawingCanvas has a source for the title block.
      w.__zilventorStore.setState({
        activeDocument: { kind: 'drawing', document: drawing },
        activeDrawing: drawing,
        activePart: part,
        activeAssembly: null,
      });

      return { partDocId: partId, drawingDocId: drawingId, sheetId };
    },
    { boxLength, boxWidth, boxHeight, sheetSize, orientation },
  );

  return result;
}

/**
 * Seeds the store with a DrawingDocument that already has one projected base view.
 * Uses setState directly to preserve activePart alongside activeDrawing.
 * Returns document IDs.
 */
export async function seedDrawingWithView(
  page: Page,
  opts: SeedDrawingWithViewOpts = {},
): Promise<SeedDrawingResult> {
  const {
    boxLength = 100, boxWidth = 60, boxHeight = 40,
    orientation = 'front',
    scale = { numerator: 1, denominator: 1 },
  } = opts;

  const result = await page.evaluate(
    ({ boxLength, boxWidth, boxHeight, orientation, scale }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): unknown;
          setState(partial: unknown): void;
        };
      };

      const partId = `seed-part-view-${Date.now()}`;
      const part = {
        id: partId,
        name: 'SeedBox',
        units: 'mm',
        parameters: { length: { value: boxLength }, width: { value: boxWidth }, height: { value: boxHeight } },
        featureTree: [],
        properties: {},
        materials: [{ id: 'm1', name: 'Birch', defaultThickness: 18, color: '#c8a96e' }],
        hardware: [],
      };

      const sheetId = `sheet-sv-${Date.now()}`;
      const viewId = `view-sv-${Date.now()}`;
      const drawingId = `drawing-sv-${Date.now()}`;

      // Synthetic projection geometry for the box (simplified rectangle)
      const visibleEdges = [
        { id: `${viewId}-e0`, kind: 'outline', points: [[0,0],[boxLength,0],[boxLength,boxHeight],[0,boxHeight],[0,0]] },
        { id: `${viewId}-e1`, kind: 'outline', points: [[0,0],[boxLength,0]] },
        { id: `${viewId}-e2`, kind: 'outline', points: [[boxLength,0],[boxLength,boxHeight]] },
        { id: `${viewId}-e3`, kind: 'outline', points: [[boxLength,boxHeight],[0,boxHeight]] },
        { id: `${viewId}-e4`, kind: 'outline', points: [[0,boxHeight],[0,0]] },
      ];

      const drawing = {
        id: drawingId,
        name: 'SeedBox — Drawing',
        units: 'mm',
        source: { partPath: `${partId}.zipt`, sourceKind: 'part' },
        properties: {},
        sheets: [{
          id: sheetId,
          name: 'Sheet 1',
          size: { kind: 'iso', size: 'A3' },
          orientation: 'landscape',
          views: [{
            id: viewId,
            kind: 'base',
            positionMm: { x: 80, y: 80 },
            scale,
            orientation,
            showHidden: false,
            projection: {
              visibleEdges,
              hiddenEdges: [],
              bbox: { minX: 0, minY: 0, maxX: boxLength, maxY: boxHeight },
            },
            inputFingerprint: `seed-fp-${partId}`,
          }],
          dimensions: [],
          annotations: [],
          titleBlock: {},
        }],
        activeSheetId: sheetId,
      };

      // Set drawing + keep activePart so DrawingCanvas has a source for the title block.
      w.__zilventorStore.setState({
        activeDocument: { kind: 'drawing', document: drawing },
        activeDrawing: drawing,
        activePart: part,
        activeAssembly: null,
      });

      return { partDocId: partId, drawingDocId: drawingId, sheetId, viewId };
    },
    { boxLength, boxWidth, boxHeight, orientation, scale },
  );

  return result;
}
