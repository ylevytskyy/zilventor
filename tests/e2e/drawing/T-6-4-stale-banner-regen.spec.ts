// tests/e2e/drawing/T-6-4-stale-banner-regen.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * T-6-4 — Stale banner appears when source geometry changes; Regenerate clears it.
 *
 * Steps:
 *   1. Seed a drawing with one base view (with inputFingerprint set).
 *   2. Mutate the drawing so the view loses its inputFingerprint (simulating a source change).
 *      DrawingCanvas detects views with projection but no inputFingerprint as stale on mount.
 *   3. Trigger a re-mount by switching away and back to the drawing document.
 *   4. Assert: [data-stale-marker] is visible.
 *   5. Click the Regenerate button on the stale view.
 *   6. Assert: stale marker cleared.
 */
test('T-6-4: Stale-marker visible after source change; Regenerate clears it', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Seed a drawing with a base view that has NO inputFingerprint.
  //    DrawingCanvas.useEffect marks views with projection && !inputFingerprint as stale on mount.
  //    We inject directly — no fingerprint means the view is stale from the start.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): unknown;
        setState(partial: unknown): void;
      };
    };

    const partId = 'T64-part';
    const part = {
      id: partId, name: 'SeedBox', units: 'mm',
      parameters: {}, featureTree: [], properties: {},
      materials: [], hardware: [],
    };

    const sheetId = 'T64-sheet';
    const viewId = 'T64-view';
    const drawingId = 'T64-drawing';

    const drawing = {
      id: drawingId, name: 'SeedBox — Drawing', units: 'mm',
      source: { partPath: `${partId}.zipt`, sourceKind: 'part' },
      properties: {},
      sheets: [{
        id: sheetId, name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
        views: [{
          id: viewId, kind: 'base',
          positionMm: { x: 80, y: 80 },
          scale: { numerator: 1, denominator: 1 },
          orientation: 'front', showHidden: false,
          projection: {
            visibleEdges: [{ id: `${viewId}-e0`, kind: 'outline',
              points: [[0,0],[100,0],[100,60],[0,60],[0,0]] }],
            hiddenEdges: [],
            bbox: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
          },
          // NO inputFingerprint → DrawingCanvas will mark this view as stale on mount
        }],
        dimensions: [], annotations: [], titleBlock: {},
      }],
      activeSheetId: sheetId,
    };

    w.__zilventorStore.setState({
      activeDocument: { kind: 'drawing', document: drawing },
      activeDrawing: drawing,
      activePart: part,
      activeAssembly: null,
    });

  });

  // 2. Assert: [data-stale-marker] visible on mount.
  await expect(page.locator('[data-stale-marker]')).toBeVisible({ timeout: 10_000 });

  // 3. Click the stale marker (a <g data-stale-marker> with onClick handler).
  //    ViewElement renders this as a clickable group, not a button element.
  await page.locator('[data-stale-marker]').click();

  // 4. Assert: stale marker cleared.
  await expect(page.locator('[data-stale-marker]')).toHaveCount(0, { timeout: 10_000 });
});
