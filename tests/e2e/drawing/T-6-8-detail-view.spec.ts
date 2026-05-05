// tests/e2e/drawing/T-6-8-detail-view.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedDrawingWithBoxPart } from '../helpers/seedDrawing';

/**
 * T-6-8 — Detail view: inject a detail view via store, assert rendering pipeline:
 *   border circle, caption, parent callout, pre-clipped edges, undo/redo.
 *
 * Uses store injection (no ribbon click) to avoid OPFS dependency, exactly
 * mirroring T-6-7's section-view pattern. The rendering pipeline (DrawingCanvas,
 * ViewElement, DetailRegionOverlay) is real and unbyassed.
 */
test('T-6-8: Detail view — inject, assert border + caption + parent callout + undo/redo', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Seed a drawing with no views (box 100×60×40, A3 landscape).
  const { sheetId } = await seedDrawingWithBoxPart(page, {
    boxLength: 100, boxWidth: 60, boxHeight: 40,
    sheetSize: 'A3', orientation: 'landscape',
  });

  // 2. Inject a base view directly via the store (same pattern as T-6-7).
  const baseViewId = 'T68-base';
  await page.evaluate(
    ({ sheetId, baseViewId }: { sheetId: string; baseViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: unknown[] }> } };
            activePart: unknown;
          };
          setState(p: unknown): void;
        };
      };
      const s = w.__zilventorStore.getState();
      const drawing = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
      if (!drawing) return;

      const baseView = {
        id: baseViewId, kind: 'base',
        positionMm: { x: 80, y: 80 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [
            { id: 'T68-e0', kind: 'outline', points: [[0, 0], [100, 0], [100, 40], [0, 40], [0, 0]] },
            { id: 'T68-e1', kind: 'outline', points: [[0, 0], [100, 0]] },
            { id: 'T68-e2', kind: 'outline', points: [[100, 0], [100, 40]] },
            { id: 'T68-e3', kind: 'outline', points: [[100, 40], [0, 40]] },
            { id: 'T68-e4', kind: 'outline', points: [[0, 40], [0, 0]] },
          ],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 100, maxY: 40 },
        },
        inputFingerprint: 'fp-T68-base',
      };

      const updated = {
        ...(drawing as object),
        sheets: (drawing as { sheets: Array<{ id: string; views: unknown[] }> }).sheets.map((sh) =>
          sh.id === sheetId ? { ...sh, views: [baseView] } : sh,
        ),
      };
      w.__zilventorStore.setState({
        activeDocument: { kind: 'drawing', document: updated },
        activeDrawing: updated,
        activePart: s.activePart,
      });
    },
    { sheetId, baseViewId },
  );

  // 3. Switch to Drawing tab; assert base view is visible.
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator(`g[data-view-id="${baseViewId}"]`)).toBeVisible({ timeout: 10_000 });

  // 4. Inject a detail view simulating AddDetailViewCommand output.
  const detailViewId = 'T68-detail';
  await page.evaluate(
    ({
      sheetId, baseViewId, detailViewId,
    }: { sheetId: string; baseViewId: string; detailViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: unknown[] }> } };
            activePart: unknown;
          };
          setState(p: unknown): void;
        };
      };
      const s = w.__zilventorStore.getState();
      const drawing = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
      if (!drawing) return;

      const detailView = {
        id: detailViewId,
        kind: 'detail',
        parentViewId: baseViewId,
        regionParent: { center: { x: 25, y: 15 }, radiusMm: 10 },
        label: 'A',
        positionMm: { x: 250, y: 80 },
        scale: { numerator: 2, denominator: 1 },
        showHidden: false,
        projection: {
          visibleEdges: [
            { id: 'T68-de0', kind: 'outline', points: [[-10, 0], [10, 0]] },
            { id: 'T68-de1', kind: 'outline', points: [[10, 0], [10, 10]] },
            { id: 'T68-de2', kind: 'outline', points: [[10, 10], [-10, 10]] },
            { id: 'T68-de3', kind: 'outline', points: [[-10, 10], [-10, 0]] },
          ],
          hiddenEdges: [],
          bbox: { minX: -10, minY: 0, maxX: 10, maxY: 10 },
        },
        inputFingerprint: 'fp-T68-detail',
      };

      const existingSheet = (drawing as { sheets: Array<{ id: string; views: unknown[] }> }).sheets.find((sh) => sh.id === sheetId)!;
      const updated = {
        ...(drawing as object),
        sheets: (drawing as { sheets: Array<{ id: string; views: unknown[] }> }).sheets.map((sh) =>
          sh.id === sheetId
            ? { ...sh, views: [...existingSheet.views, detailView] }
            : sh,
        ),
      };
      w.__zilventorStore.setState({
        activeDocument: { kind: 'drawing', document: updated },
        activeDrawing: updated,
        activePart: s.activePart,
      });
    },
    { sheetId, baseViewId, detailViewId },
  );

  // 5. Assert: detail view visible in canvas with correct data-view-id.
  await expect(page.locator(`g[data-view-id="${detailViewId}"]`)).toBeVisible({ timeout: 10_000 });

  // 6. Assert: detail view has pre-clipped edges (at least one polyline in DOM).
  const detailEdges = page.locator(`[data-view-id="${detailViewId}"] polyline`);
  await expect(detailEdges.first()).toBeAttached({ timeout: 5_000 });

  // 7. Assert: "DETAIL A" caption present in DOM with data-role="detail-caption".
  // In the live canvas (ViewElement), the caption text has data-role="detail-caption" inside
  // the parent g[data-view-id]. Accept either combined attribute or descendant pattern.
  const captionEl = page.locator(`g[data-view-id="${detailViewId}"] [data-role="detail-caption"]`);
  await expect(captionEl).toBeAttached({ timeout: 5_000 });
  await expect(page.getByText('DETAIL A')).toBeVisible({ timeout: 3_000 });

  // 8. Assert: scale "2:1" present in caption.
  await expect(page.getByText('2:1')).toBeVisible({ timeout: 3_000 });

  // 9. Assert: detail border circle present in DOM with data-role="detail-border".
  // In the live canvas (ViewElement), the circle is inside g[data-view-id].
  const borderCircle = page.locator(`g[data-view-id="${detailViewId}"] [data-role="detail-border"]`);
  await expect(borderCircle).toBeAttached({ timeout: 5_000 });

  // 10. Assert: parent callout circle present (DetailRegionOverlay uses data-detail-callout-overlay).
  const calloutOverlay = page.locator(`[data-detail-callout-overlay="${detailViewId}"]`);
  await expect(calloutOverlay).toBeAttached({ timeout: 5_000 });

  // 11. Assert: parent callout letter label "A" present inside the overlay group.
  const calloutText = calloutOverlay.locator('[data-role="detail-callout-label"]').last();
  await expect(calloutText).toHaveText('A', { timeout: 3_000 });

  // 12. Assert: no stale banner on fresh injection.
  await expect(page.locator('[data-stale-marker]')).toHaveCount(0, { timeout: 3_000 });

  // 13. Undo: remove detail view via store.
  await page.evaluate(({ sheetId, baseViewId }: { sheetId: string; baseViewId: string }) => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: Array<{ id: string }> }> } };
          activePart: unknown;
        };
        setState(p: unknown): void;
      };
    };
    const s = w.__zilventorStore.getState();
    const drawing = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
    if (!drawing) return;
    const updated = {
      ...(drawing as object),
      sheets: (drawing as { sheets: Array<{ id: string; views: Array<{ id: string }> }> }).sheets.map((sh) =>
        sh.id === sheetId
          ? { ...sh, views: sh.views.filter((v) => v.id === baseViewId) }
          : sh,
      ),
    };
    w.__zilventorStore.setState({
      activeDocument: { kind: 'drawing', document: updated },
      activeDrawing: updated,
      activePart: s.activePart,
    });
  }, { sheetId, baseViewId });

  await expect(page.locator(`g[data-view-id="${detailViewId}"]`)).toHaveCount(0, { timeout: 5_000 });
  await expect(page.locator(`[data-detail-callout-overlay="${detailViewId}"]`)).toHaveCount(0, { timeout: 5_000 });

  // 14. Redo: re-inject detail view (simulate redo by restoring state).
  await page.evaluate(
    ({ sheetId, detailViewId }: { sheetId: string; detailViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: unknown[] }> } };
            activePart: unknown;
          };
          setState(p: unknown): void;
        };
      };
      const s = w.__zilventorStore.getState();
      const drawing = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
      if (!drawing) return;
      const detailView = {
        id: detailViewId, kind: 'detail', label: 'A',
        parentViewId: 'T68-base',
        regionParent: { center: { x: 25, y: 15 }, radiusMm: 10 },
        positionMm: { x: 250, y: 80 },
        scale: { numerator: 2, denominator: 1 }, showHidden: false,
        projection: {
          visibleEdges: [{ id: 'T68-de0-redo', kind: 'outline', points: [[-10, 0], [10, 0]] }],
          hiddenEdges: [],
          bbox: { minX: -10, minY: 0, maxX: 10, maxY: 10 },
        },
        inputFingerprint: 'fp-T68-detail-redo',
      };
      const existingViews = (drawing as { sheets: Array<{ id: string; views: unknown[] }> }).sheets.find((sh) => sh.id === sheetId)!.views;
      const updated = {
        ...(drawing as object),
        sheets: (drawing as { sheets: Array<{ id: string; views: unknown[] }> }).sheets.map((sh) =>
          sh.id === sheetId
            ? { ...sh, views: [...existingViews, detailView] }
            : sh,
        ),
      };
      w.__zilventorStore.setState({
        activeDocument: { kind: 'drawing', document: updated },
        activeDrawing: updated,
        activePart: s.activePart,
      });
    },
    { sheetId, detailViewId },
  );

  await expect(page.locator(`g[data-view-id="${detailViewId}"]`)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('DETAIL A')).toBeVisible({ timeout: 3_000 });
});
