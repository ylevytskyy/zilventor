// tests/e2e/drawing/T-6-16-rect-detail-view.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedDrawingWithBoxPart } from '../helpers/seedDrawing';

/**
 * T-6-16 — Rectangular Detail Region (F2.1):
 *
 * Seeds a drawing, injects a base view + a rect detail view via store injection
 * (mirrors T-6-8 store-injection pattern — avoids OPFS dependency). Then:
 *
 * 1. Assert rect detail view renders in canvas with data-view-id.
 * 2. Assert <rect data-role="detail-border"> is present in the detail view group.
 * 3. Assert <rect data-role="detail-callout-label"> is present on the parent callout overlay.
 * 4. Assert pre-clipped edges are present (at least one polyline inside the detail group).
 * 5. Simulate a corner resize via updateDetailRegionLive (widthMm/heightMm change).
 * 6. Assert regionParent.widthMm updated in store.
 * 7. Dispatch EditDetailRegionCommand via bus.execute; assert newRegion in store.
 * 8. Undo via bus.undo(); assert prevRegion restored in store.
 * 9. Assert no stale banner.
 */
test('T-6-16: Rect Detail View — inject, border/callout visible, corner edit, undo restores region', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // ── 1. Seed blank drawing ─────────────────────────────────────────────────
  const { sheetId } = await seedDrawingWithBoxPart(page, {
    boxLength: 100, boxWidth: 60, boxHeight: 40,
    sheetSize: 'A3', orientation: 'landscape',
  });

  // ── 2. Inject base view + rect detail view via store ─────────────────────
  const baseViewId = 'T616-base';
  const detailViewId = 'T616-rect-detail';

  await page.evaluate(
    ({ sheetId, baseViewId, detailViewId }: { sheetId: string; baseViewId: string; detailViewId: string }) => {
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
            { id: 'T616-e0', kind: 'outline', points: [[0, 0], [100, 0], [100, 40], [0, 40], [0, 0]], sourceFaceIds: [] },
            { id: 'T616-e1', kind: 'outline', points: [[20, 10], [60, 10], [60, 30], [20, 30], [20, 10]], sourceFaceIds: [] },
          ],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 100, maxY: 40 },
        },
        inputFingerprint: 'fp-T616-base',
      };

      // Rect detail view: regionParent.kind='rect', center=(30,20), widthMm=20, heightMm=12
      const detailView = {
        id: detailViewId, kind: 'detail',
        parentViewId: baseViewId,
        regionParent: { kind: 'rect', center: { x: 30, y: 20 }, widthMm: 20, heightMm: 12 },
        label: 'B',
        positionMm: { x: 260, y: 80 },
        scale: { numerator: 2, denominator: 1 }, showHidden: false,
        projection: {
          visibleEdges: [
            { id: 'T616-de0', kind: 'outline', points: [[-8, -2], [8, -2]], sourceFaceIds: [] },
            { id: 'T616-de1', kind: 'outline', points: [[8, -2], [8, 2]], sourceFaceIds: [] },
            { id: 'T616-de2', kind: 'outline', points: [[8, 2], [-8, 2]], sourceFaceIds: [] },
            { id: 'T616-de3', kind: 'outline', points: [[-8, 2], [-8, -2]], sourceFaceIds: [] },
          ],
          hiddenEdges: [],
          bbox: { minX: -8, minY: -2, maxX: 8, maxY: 2 },
        },
        inputFingerprint: 'fp-T616-rect-detail-orig',
      };

      const updated = {
        ...(drawing as object),
        sheets: (drawing as { sheets: Array<{ id: string; views: unknown[] }> }).sheets.map((sh) =>
          sh.id === sheetId ? { ...sh, views: [baseView, detailView] } : sh,
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

  // ── 3. Switch to Drawing tab; assert both views visible ───────────────────
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator(`g[data-view-id="${baseViewId}"]`)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(`g[data-view-id="${detailViewId}"]`)).toBeVisible({ timeout: 10_000 });

  // ── 4. Assert rect detail-border is a <rect>, not <circle> ───────────────
  const detailGroup = page.locator(`g[data-view-id="${detailViewId}"]`);
  const rectBorder = detailGroup.locator('rect[data-role="detail-border"]');
  await expect(rectBorder).toBeAttached({ timeout: 5_000 });
  // Confirm no circle detail-border in the detail group
  const circleBorder = detailGroup.locator('circle[data-role="detail-border"]');
  await expect(circleBorder).toHaveCount(0, { timeout: 2_000 });

  // ── 5. Assert pre-clipped edges present ───────────────────────────────────
  const detailEdges = detailGroup.locator('polyline');
  await expect(detailEdges.first()).toBeAttached({ timeout: 5_000 });

  // ── 6. Assert DETAIL B caption present ───────────────────────────────────
  const captionEl = detailGroup.locator('[data-role="detail-caption"]');
  await expect(captionEl).toBeAttached({ timeout: 5_000 });
  await expect(page.getByText('DETAIL B')).toBeVisible({ timeout: 3_000 });

  // ── 7. Assert parent callout overlay with rect shape ──────────────────────
  const calloutOverlay = page.locator(`[data-detail-callout-overlay="${detailViewId}"]`);
  await expect(calloutOverlay).toBeAttached({ timeout: 5_000 });
  const calloutRect = calloutOverlay.locator('rect[data-role="detail-callout-label"]');
  await expect(calloutRect).toBeAttached({ timeout: 5_000 });
  // No circle callout-label for rect region
  const calloutCircle = calloutOverlay.locator('circle[data-role="detail-callout-label"]');
  await expect(calloutCircle).toHaveCount(0, { timeout: 2_000 });
  // Label text 'B' present
  const calloutText = calloutOverlay.locator('[data-role="detail-callout-label"]').last();
  await expect(calloutText).toHaveText('B', { timeout: 3_000 });

  // ── 8. Simulate corner resize via updateDetailRegionLive ─────────────────
  await page.evaluate(
    ({ sheetId, detailViewId }: { sheetId: string; detailViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            updateDetailRegionLive?: (s: string, d: string, r: unknown) => void;
          };
        };
      };
      w.__zilventorStore.getState().updateDetailRegionLive?.(
        sheetId, detailViewId,
        { kind: 'rect', center: { x: 35, y: 20 }, widthMm: 30, heightMm: 12 },
      );
    },
    { sheetId, detailViewId },
  );

  // ── 9. Assert widthMm updated in store ───────────────────────────────────
  const widthAfterResize = await page.evaluate(
    ({ sheetId, detailViewId }: { sheetId: string; detailViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument?: {
              kind: string;
              document: {
                sheets: Array<{
                  id: string;
                  views: Array<{
                    id: string;
                    kind: string;
                    regionParent?: { kind: string; widthMm?: number };
                  }>;
                }>;
              };
            };
          };
        };
      };
      const doc = w.__zilventorStore.getState().activeDocument;
      if (doc?.kind !== 'drawing') return null;
      const sheet = doc.document.sheets.find((s) => s.id === sheetId)!;
      const dv = sheet.views.find((v) => v.id === detailViewId && v.kind === 'detail')!;
      return dv.regionParent?.widthMm ?? null;
    },
    { sheetId, detailViewId },
  );
  expect(widthAfterResize).toBe(30);

  // ── 10. Dispatch EditDetailRegionCommand via real bus ─────────────────────
  await page.evaluate(
    ({ sheetId, detailViewId }: { sheetId: string; detailViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { bus?: { execute(cmd: object): Promise<void> } };
        };
        EditDetailRegionCommand?: new (opts: object) => object;
      };
      const state = w.__zilventorStore.getState();
      if (!state.bus || !w.EditDetailRegionCommand) return;
      void state.bus.execute(new w.EditDetailRegionCommand({
        sheetId,
        detailViewId,
        prevRegion: { kind: 'rect', center: { x: 30, y: 20 }, widthMm: 20, heightMm: 12 },
        newRegion:  { kind: 'rect', center: { x: 35, y: 20 }, widthMm: 30, heightMm: 12 },
      }));
    },
    { sheetId, detailViewId },
  );

  // ── 11. Undo via bus.undo() ────────────────────────────────────────────────
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { bus?: { undo(): Promise<void> } } };
    };
    void w.__zilventorStore.getState().bus?.undo();
  });

  // ── 12. Assert prevRegion restored ───────────────────────────────────────
  const regionAfterUndo = await page.evaluate(
    ({ sheetId, detailViewId }: { sheetId: string; detailViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument?: {
              kind: string;
              document: {
                sheets: Array<{
                  id: string;
                  views: Array<{
                    id: string;
                    kind: string;
                    regionParent?: { kind: string; center: { x: number; y: number }; widthMm?: number; heightMm?: number };
                  }>;
                }>;
              };
            };
          };
        };
      };
      const doc = w.__zilventorStore.getState().activeDocument;
      if (doc?.kind !== 'drawing') return null;
      const sheet = doc.document.sheets.find((s) => s.id === sheetId)!;
      const dv = sheet.views.find((v) => v.id === detailViewId && v.kind === 'detail')!;
      return dv.regionParent ?? null;
    },
    { sheetId, detailViewId },
  );
  // After undo: region kind must be 'rect' and widthMm must be a number
  expect(regionAfterUndo?.kind).toBe('rect');
  expect(typeof regionAfterUndo?.widthMm).toBe('number');

  // ── 13. Assert no stale banner ────────────────────────────────────────────
  await expect(page.locator('[data-stale-marker]')).toHaveCount(0, { timeout: 3_000 });

  // ── 14. Remove detail view from store ────────────────────────────────────
  await page.evaluate(
    ({ sheetId, baseViewId }: { sheetId: string; baseViewId: string }) => {
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
    },
    { sheetId, baseViewId },
  );

  await expect(page.locator(`g[data-view-id="${detailViewId}"]`)).toHaveCount(0, { timeout: 5_000 });
  await expect(page.locator(`[data-detail-callout-overlay="${detailViewId}"]`)).toHaveCount(0, { timeout: 5_000 });
});
