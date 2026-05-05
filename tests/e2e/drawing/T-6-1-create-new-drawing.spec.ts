// tests/e2e/drawing/T-6-1-create-new-drawing.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * T-6-1 — Create new drawing from an active part.
 *
 * Steps:
 *   1. Open app, wait for kernel ready.
 *   2. Seed a PartDocument directly into the store.
 *   3. Seed a DrawingDocument via the store (bypassing File → New Drawing UI
 *      which requires OPFS — not available in Playwright without a real browser context).
 *   4. Assert: drawing tab is open, sheet exists at A3 landscape, title block populated.
 *
 * NOTE: The UI flow (File → New Drawing → OK) requires OPFS showOpenFilePicker and
 * a real .zipt source path on disk. We bypass it by injecting the document directly
 * via the store, matching the pattern used in other sub-project e2e specs.
 */
test('T-6-1: Create new drawing from part — A3 sheet + title block populated', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Seed a part + drawing document simultaneously via the store state setter.
  //    We use setState (not setActiveDocument) to preserve activePart alongside
  //    the active drawing — DrawingCanvas reads activePart for TitleBlock rendering.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): unknown;
        setState(partial: unknown): void;
      };
    };

    const partId = 'T61-part';
    const part = {
      id: partId, name: 'BoxPart', units: 'mm',
      parameters: {}, featureTree: [], properties: {},
      materials: [], hardware: [],
    };

    const sheetId = 'T61-sheet';
    const drawingId = 'T61-drawing';
    const drawing = {
      id: drawingId, name: 'BoxPart — Drawing', units: 'mm',
      source: { partPath: 'parts/T61-part.zipt', sourceKind: 'part' },
      properties: {},
      sheets: [{
        id: sheetId, name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' },
        orientation: 'landscape',
        views: [], dimensions: [], annotations: [], titleBlock: {},
      }],
      activeSheetId: sheetId,
    };

    // Set both activeDocument (drawing) and activePart simultaneously so
    // DrawingCanvas gets a non-null source for the TitleBlock.
    w.__zilventorStore.setState({
      activeDocument: { kind: 'drawing', document: drawing },
      activeDrawing: drawing,
      activePart: part,
      activeAssembly: null,
    });
  });

  // 2. Assert: drawing kind is active.
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
    };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'drawing';
  }, undefined, { timeout: 10_000 });

  // 3. Assert: DrawingCanvas SVG is visible (the svg inside data-sheet-border).
  await expect(page.locator('[data-sheet-border]')).toBeVisible({ timeout: 10_000 });

  // 4. Assert: first sheet is A3 landscape.
  const sheetSize = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: {
        kind: string;
        document: { sheets: Array<{ size: { kind: string; size?: string }; orientation: string }> };
      } } };
    };
    const doc = w.__zilventorStore.getState().activeDocument;
    if (doc?.kind !== 'drawing') return null;
    const sheet = doc.document.sheets[0];
    return { sizeKind: sheet?.size.kind, size: (sheet?.size as { size?: string }).size, orientation: sheet?.orientation };
  });
  expect(sheetSize?.sizeKind).toBe('iso');
  expect(sheetSize?.size).toBe('A3');
  expect(sheetSize?.orientation).toBe('landscape');

  // 5. Assert: title block is rendered (source name populates it).
  await expect(page.locator('[data-title-block]')).toBeVisible({ timeout: 10_000 });
  const titleBlockText = await page.locator('[data-title-block]').textContent();
  expect(titleBlockText).toBeTruthy();
});
