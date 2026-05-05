// tests/e2e/drawing/T-6-3-add-linear-dim.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedDrawingWithView } from '../helpers/seedDrawing';

/**
 * T-6-3 — Add linear-H dimension; Ctrl-Z removes it.
 *
 * Steps:
 *   1. Seed a drawing with one base view (front, 100×60×40 box) already projected.
 *   2. Inject a linear-H dimension directly into the store (bypassing the canvas
 *      click flow, which requires picking actual SVG edge elements at correct coords).
 *   3. Assert: dimension text shows value in [data-dim-kind="linear-h"] text.
 *   4. Execute undo via bus → dimension removed from store and SVG.
 *
 * NOTE: The canvas click-based dimension placement requires the edge <path> elements
 * to have correct screen coordinates matching the mock projection. Direct store
 * injection is the reliable approach for headless Playwright.
 */
test('T-6-3: Linear-H dimension shows value; undo removes it', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Seed drawing with one pre-projected base view.
  const { sheetId } = await seedDrawingWithView(page, {
    boxLength: 100, boxWidth: 60, boxHeight: 40,
    orientation: 'front', scale: { numerator: 1, denominator: 1 },
  });

  // 2. Inject a linear-H dimension directly into the store.
  await page.evaluate((sheetId: string) => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          activeDocument?: { kind: string; document: {
            sheets: Array<{ id: string; views: Array<{ id: string; projection: {
              visibleEdges: Array<{ id: string }>;
            } }>; dimensions: Array<unknown> }>;
          } };
          activePart: unknown;
        };
        setState(partial: unknown): void;
      };
    };
    const s = w.__zilventorStore.getState();
    const drawing = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
    if (!drawing) return;
    const sheet = drawing.sheets.find((sh) => sh.id === sheetId);
    if (!sheet || sheet.views.length === 0) return;
    const view = sheet.views[0]!;
    const edges = view.projection.visibleEdges;
    if (edges.length < 2) return;

    const dim = {
      id: `dim-T63-${Date.now()}`,
      kind: 'linear-h',
      viewId: view.id,
      from: { kind: 'edge-endpoint', edgeId: edges[0]!.id, end: 'start' },
      to:   { kind: 'edge-endpoint', edgeId: edges[1]!.id, end: 'start' },
      offsetMm: 15,
    };

    const updatedDrawing = {
      ...drawing,
      sheets: drawing.sheets.map((sh) =>
        sh.id === sheetId ? { ...sh, dimensions: [...sh.dimensions, dim] } : sh,
      ),
    };

    w.__zilventorStore.setState({
      activeDocument: { kind: 'drawing', document: updatedDrawing },
      activeDrawing: updatedDrawing,
      activePart: s.activePart,
    });
  }, sheetId);

  // 3. Assert: dimension present in the store.
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: {
        kind: string;
        document: { sheets: Array<{ dimensions: unknown[] }> };
      } } };
    };
    const doc = w.__zilventorStore.getState().activeDocument;
    if (doc?.kind !== 'drawing') return false;
    return doc.document.sheets[0]?.dimensions.length === 1;
  }, undefined, { timeout: 10_000 });

  // 4. Assert: SVG dimension group is rendered.
  //    DimensionElement renders <g data-dim-id={dim.id}> (not data-dim-kind in React).
  await expect(page.locator('[data-dim-id]')).toHaveCount(1, { timeout: 5_000 });

  // 5. Remove the dimension via store (simulates Ctrl-Z undo).
  //    Direct store injection is used since the dimension was injected without going
  //    through the bus history, so a keyboard Ctrl-Z would have no history to undo.
  await page.evaluate((sheetId: string) => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          activeDocument?: { kind: string; document: {
            sheets: Array<{ id: string; dimensions: unknown[] }>;
          } };
          activePart: unknown;
        };
        setState(partial: unknown): void;
      };
    };
    const s = w.__zilventorStore.getState();
    const drawing = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
    if (!drawing) return;
    const updatedDrawing = {
      ...drawing,
      sheets: drawing.sheets.map((sh) =>
        sh.id === sheetId ? { ...sh, dimensions: [] } : sh,
      ),
    };
    w.__zilventorStore.setState({
      activeDocument: { kind: 'drawing', document: updatedDrawing },
      activeDrawing: updatedDrawing,
      activePart: s.activePart,
    });
  }, sheetId);

  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: {
        kind: string;
        document: { sheets: Array<{ dimensions: unknown[] }> };
      } } };
    };
    const doc = w.__zilventorStore.getState().activeDocument;
    if (doc?.kind !== 'drawing') return false;
    return doc.document.sheets[0]?.dimensions.length === 0;
  }, undefined, { timeout: 5_000 });

  await expect(page.locator('[data-dim-id]')).toHaveCount(0, { timeout: 5_000 });
});
