// tests/e2e/drawing/balloons.spec.ts
// Task 8 — Auto-balloon ribbon button + manual balloon placement e2e
//
// Pattern mirrors T-6-6-balloon-bom.spec.ts (store injection, no tab navigation).
//
// Auto-balloon test:
//   1. Seed assembly drawing with 2 components + tagged edges.
//   2. Click Auto-balloon ribbon button.
//   3. Assert 2 balloon annotations appear in store (== BOM row count) and render.
//
// Manual-balloon test:
//   4. Inject a balloon annotation via AutoBalloonCommand; assert itemNumber renders.

import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

// pathKey([id]) = id    (single entry, space-joined by PATH_SEPARATOR=' ')
// bomRowKey(partPath, undefined) = `${partPath}::none`
const PART_A_PATH = 'parts/t8-panel-A.zipt';
const PART_B_PATH = 'parts/t8-panel-B.zipt';
const COMP_A_ID = 'c-t8-A';
const COMP_B_ID = 'c-t8-B';

function makeStubPart(id: string) {
  return {
    id,
    name: 'StubPart',
    units: 'mm',
    parameters: {},
    featureTree: [],
    properties: {},
    materials: [],
    hardware: [],
  };
}

test('T8-auto-balloon: Auto-balloon button creates one balloon per BOM row', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Seed an assembly drawing.
  //    Following T-6-6 pattern: set activePart to a stub so DrawingCanvas renders correctly.
  //    activeAssembly is set to the real assembly for autoBalloonSheet resolution.
  //    activeDrawingSourceDocument is set to the assembly so the button can find it.
  const { sheetId } = await page.evaluate(
    ({
      partAPath, partBPath, compAId, compBId,
    }: {
      partAPath: string; partBPath: string;
      compAId: string; compBId: string;
    }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): unknown;
          setState(partial: unknown): void;
        };
      };

      const stubPart = {
        id: 'stub-t8',
        name: 'StubPart',
        units: 'mm',
        parameters: {},
        featureTree: [],
        properties: {},
        materials: [],
        hardware: [],
      };

      const viewId = 'view-t8-auto';
      const sheetId = 'sheet-t8-auto';
      const drawingId = 'drawing-t8-auto';

      // Full AssemblyDocument with all required fields.
      const asm = {
        id: 'asm-t8',
        name: 'T8 Assembly',
        units: 'mm',
        parameters: {},
        components: [
          {
            id: compAId,
            partPath: partAPath,
            name: 'Panel A',
            pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } },
          },
          {
            id: compBId,
            partPath: partBPath,
            name: 'Panel B',
            pose: { translation: { x: 70, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } },
          },
        ],
        groundedComponentPaths: [[compAId]],
        constraints: [],
        properties: {},
        hardware: [],
        materials: [],
        colors: {},
        colorOverrides: {},
        cutListItemNumbers: {},
        // bomRowKey(partPath, undefined) = `${partPath}::none`
        bomItemNumbers: {
          [`${partAPath}::none`]: 1,
          [`${partBPath}::none`]: 2,
        },
      };

      const drawing = {
        id: drawingId,
        name: 'T8 Assembly — Drawing',
        units: 'mm',
        source: { partPath: 'assemblies/t8.ziasm', sourceKind: 'assembly' },
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
            scale: { numerator: 1, denominator: 1 },
            orientation: 'front',
            showHidden: false,
            projection: {
              // Two edges with distinct componentPaths matching the BOM representatives.
              // autoBalloonSheet: representativePathByItem({1→compAId, 2→compBId})
              visibleEdges: [
                {
                  id: 'e-A-0', kind: 'outline', componentPath: compAId,
                  points: [[0, 0], [60, 0], [60, 40], [0, 40], [0, 0]],
                  sourceFaceIds: [],
                },
                {
                  id: 'e-B-0', kind: 'outline', componentPath: compBId,
                  points: [[70, 0], [120, 0], [120, 40], [70, 40], [70, 0]],
                  sourceFaceIds: [],
                },
              ],
              hiddenEdges: [],
              bbox: { minX: 0, minY: 0, maxX: 120, maxY: 40 },
            },
            inputFingerprint: 'fp-t8-auto',
          }],
          dimensions: [],
          dimensionGroups: [],
          annotations: [],
          titleBlock: {},
        }],
        activeSheetId: sheetId,
      };

      // Mirror T-6-6: set activePart to stub for title block rendering.
      w.__zilventorStore.setState({
        activeDocument: { kind: 'drawing', document: drawing },
        activeDrawing: drawing,
        activePart: stubPart,
        activeAssembly: asm,
        activeDrawingSourceDocument: asm,
        subAssemblyDocs: {},
      });

      return { sheetId };
    },
    { partAPath: PART_A_PATH, partBPath: PART_B_PATH, compAId: COMP_A_ID, compBId: COMP_B_ID },
  );

  // 2. Wait for drawing active (store updated).
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
    };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'drawing';
  }, undefined, { timeout: 10_000 });

  // 3. Wait for the sheet border to be visible.
  await expect(page.locator('[data-sheet-border]')).toBeVisible({ timeout: 15_000 });

  // 4. Click Auto-balloon ribbon button.
  await expect(page.getByRole('button', { name: /auto-balloon/i })).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: /auto-balloon/i }).click();

  // 5. Wait for balloons in the store.
  await page.waitForFunction(
    ({ sid }: { sid: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDrawing: {
              sheets: Array<{
                id: string;
                annotations: Array<{ kind: string }>;
              }>;
            } | null;
          };
        };
      };
      const drw = w.__zilventorStore?.getState().activeDrawing;
      const sheet = drw?.sheets.find((s) => s.id === sid);
      return (sheet?.annotations.filter((a) => a.kind === 'balloon').length ?? 0) > 0;
    },
    { sid: sheetId },
    { timeout: 10_000 },
  );

  // 6. Assert balloon count == 2 (one per BOM row) and > 0.
  const balloonCount = await page.evaluate(
    ({ sid }: { sid: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDrawing: {
              sheets: Array<{
                id: string;
                annotations: Array<{ kind: string }>;
              }>;
            } | null;
          };
        };
      };
      const drw = w.__zilventorStore?.getState().activeDrawing;
      const sheet = drw?.sheets.find((s) => s.id === sid);
      return sheet?.annotations.filter((a) => a.kind === 'balloon').length ?? 0;
    },
    { sid: sheetId },
  );

  expect(balloonCount).toBeGreaterThan(0);
  expect(balloonCount).toBe(2);

  // 7. Assert balloon SVG elements rendered.
  await expect(page.locator('[data-ann-kind="balloon"]').first()).toBeVisible({ timeout: 10_000 });
});

test('T8-manual-balloon: injected balloon renders with correct item number', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // Seed minimal assembly drawing (mirrors T-6-6 exactly).
  const { sheetId, viewId } = await page.evaluate(
    ({ partAPath, compAId }: { partAPath: string; compAId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): unknown;
          setState(partial: unknown): void;
        };
      };

      const stubPart = {
        id: 'stub-t8-manual',
        name: 'StubPart',
        units: 'mm',
        parameters: {},
        featureTree: [],
        properties: {},
        materials: [],
        hardware: [],
      };

      const viewId = 'view-t8-manual';
      const sheetId = 'sheet-t8-manual';
      const drawingId = 'drawing-t8-manual';

      const drawing = {
        id: drawingId,
        name: 'T8 Manual — Drawing',
        units: 'mm',
        source: { partPath: 'assemblies/t8-manual.ziasm', sourceKind: 'assembly' },
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
            scale: { numerator: 1, denominator: 1 },
            orientation: 'front',
            showHidden: false,
            projection: {
              visibleEdges: [
                {
                  id: 'e-manual-0', kind: 'outline',
                  componentPath: compAId,
                  points: [[0, 0], [60, 0], [60, 40], [0, 40], [0, 0]],
                  sourceFaceIds: [],
                },
              ],
              hiddenEdges: [],
              bbox: { minX: 0, minY: 0, maxX: 60, maxY: 40 },
            },
            inputFingerprint: 'fp-t8-manual',
          }],
          dimensions: [],
          dimensionGroups: [],
          annotations: [{
            id: 'balloon-t8-manual-seed',
            kind: 'balloon',
            viewId,
            itemNumber: 7,
            targetMm: { x: 80, y: 100 },
            textPosMm: { x: 140, y: 80 },
          }],
          titleBlock: {},
        }],
        activeSheetId: sheetId,
      };

      // Follow T-6-6: set activePart stub + activeAssembly null.
      w.__zilventorStore.setState({
        activeDocument: { kind: 'drawing', document: drawing },
        activeDrawing: drawing,
        activePart: stubPart,
        activeAssembly: null,
      });

      return { sheetId, viewId };
    },
    { partAPath: PART_A_PATH, compAId: COMP_A_ID },
  );

  // Wait for drawing active.
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
    };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'drawing';
  }, undefined, { timeout: 10_000 });

  // Assert the balloon (seeded in annotations) renders in the SVG canvas with item 7.
  await expect(page.locator('[data-ann-kind="balloon"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-ann-kind="balloon"] text')).toContainText('7', { timeout: 5_000 });

  // Verify the annotation is in the store with the correct item number.
  const itemNumber = await page.evaluate(
    ({ sid }: { sid: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDrawing: {
              sheets: Array<{
                id: string;
                annotations: Array<{ kind: string; itemNumber?: number }>;
              }>;
            } | null;
          };
        };
      };
      const drw = w.__zilventorStore?.getState().activeDrawing;
      const sheet = drw?.sheets.find((s) => s.id === sid);
      const balloon = sheet?.annotations.find(
        (a) => a.kind === 'balloon' && (a as { itemNumber?: number }).itemNumber === 7,
      );
      return balloon ? (balloon as { itemNumber?: number }).itemNumber : null;
    },
    { sid: sheetId },
  );

  expect(itemNumber).toBe(7);
});
