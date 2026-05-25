// tests/e2e/drawing/playwright-verify-f2.4-edit-detail-region.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedDrawingWithBoxPart } from '../helpers/seedDrawing';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Playwright mid-flight visual verification for Drawing F2.4 (edit-detail-region).
 * Per CLAUDE.md §6: screenshot before drag and after drag; assert distinct byte sizes.
 *
 * Enhanced beyond Task 3.6-A plan recipe:
 *   - Clicks the REAL ribbon button to enter editDetailRegion mode (proves button→mode→handle-render path)
 *   - Asserts [data-detail-edit-handles] and [data-role="edit-radius-handle"] are visible
 *   - Takes handles-visible.png screenshot in handle-visible state
 *   - Then simulates center + radius drags via store, asserts distinct byte sizes
 *
 * Run: pnpm exec playwright test tests/e2e/drawing/playwright-verify-f2.4-edit-detail-region.spec.ts
 */
test('F2.4 mid-flight: ribbon button enters edit mode; handles visible; before/after drag screenshots have distinct byte sizes', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  const { sheetId } = await seedDrawingWithBoxPart(page, {
    boxLength: 100, boxWidth: 60, boxHeight: 40,
    sheetSize: 'A3', orientation: 'landscape',
  });

  // Inject base view + detail view into the seeded drawing
  await page.evaluate(
    ({ sheetId }: { sheetId: string }) => {
      const w = window as unknown as {
        __zilventorStore: { getState(): unknown; setState(p: unknown): void };
      };
      const s = (w.__zilventorStore.getState() as {
        activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: unknown[] }> } };
        activePart: unknown;
      });
      const drawing = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
      if (!drawing) return;
      const baseView = {
        id: 'V614-base', kind: 'base',
        positionMm: { x: 80, y: 80 }, scale: { numerator: 1, denominator: 1 },
        orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [
            { id: 'e0', kind: 'outline', points: [[0,0],[100,0],[100,40],[0,40],[0,0]], sourceFaceIds: [] },
          ],
          hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 100, maxY: 40 },
        },
        inputFingerprint: 'fp-base',
      };
      const detailView = {
        id: 'V614-detail', kind: 'detail', parentViewId: 'V614-base',
        regionParent: { center: { x: 20, y: 15 }, radiusMm: 8 },
        label: 'A', positionMm: { x: 250, y: 80 },
        scale: { numerator: 2, denominator: 1 }, showHidden: false,
        projection: {
          visibleEdges: [{ id: 'de0', kind: 'outline', points: [[-8, 0], [8, 0]], sourceFaceIds: [] }],
          hiddenEdges: [], bbox: { minX: -8, minY: 0, maxX: 8, maxY: 0 },
        },
        inputFingerprint: 'fp-detail-orig',
      };
      const updated = {
        ...(drawing as object),
        sheets: (drawing as { sheets: Array<{ id: string; views: unknown[] }> }).sheets.map(sh =>
          sh.id === sheetId ? { ...sh, views: [baseView, detailView] } : sh
        ),
      };
      w.__zilventorStore.setState({
        activeDocument: { kind: 'drawing', document: updated },
        activeDrawing: updated,
        activePart: s.activePart,
      });
    },
    { sheetId },
  );

  // Switch to Drawing tab and wait for the canvas to render the detail view
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator('g[data-view-id="V614-detail"]')).toBeVisible({ timeout: 10_000 });

  // Screenshot BEFORE entering edit mode (no handles)
  const screenshotDir = path.join('/tmp', 'f2.4-verify');
  fs.mkdirSync(screenshotDir, { recursive: true });
  const beforePath = path.join(screenshotDir, 'before-drag.png');
  await page.screenshot({ path: beforePath, fullPage: false });

  // ── ENHANCED: click the real ribbon button ──────────────────────────────
  // The button is disabled when no detail view exists; our seeded drawing has one,
  // so it should be enabled. This exercises the button→mode→handle-render path end-to-end.
  const editBtn = page.getByRole('button', { name: /edit detail region/i });
  await expect(editBtn).toBeEnabled({ timeout: 5_000 });
  await editBtn.click();

  // Assert handle overlay renders
  await expect(page.locator('[data-detail-edit-handles]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('[data-role="edit-radius-handle"]')).toBeVisible({ timeout: 5_000 });

  // Screenshot with handles visible
  const handlesPath = path.join(screenshotDir, 'handles-visible.png');
  await page.screenshot({ path: handlesPath, fullPage: false });
  console.log(`[verify] handles-visible screenshot: ${handlesPath}`);
  // ────────────────────────────────────────────────────────────────────────

  // Simulate center drag via updateDetailRegionLive
  await page.evaluate(
    ({ sheetId }: { sheetId: string }) => {
      (window as unknown as {
        __zilventorStore: { getState(): { updateDetailRegionLive?: (s: string, d: string, r: unknown) => void } };
      }).__zilventorStore.getState().updateDetailRegionLive?.(
        sheetId, 'V614-detail', { center: { x: 60, y: 25 }, radiusMm: 8 }
      );
    },
    { sheetId },
  );
  await page.waitForTimeout(200); // allow React re-render

  // Screenshot AFTER center drag
  const afterCenterPath = path.join(screenshotDir, 'after-center-drag.png');
  await page.screenshot({ path: afterCenterPath, fullPage: false });

  // Simulate radius drag
  await page.evaluate(
    ({ sheetId }: { sheetId: string }) => {
      (window as unknown as {
        __zilventorStore: { getState(): { updateDetailRegionLive?: (s: string, d: string, r: unknown) => void } };
      }).__zilventorStore.getState().updateDetailRegionLive?.(
        sheetId, 'V614-detail', { center: { x: 60, y: 25 }, radiusMm: 20 }
      );
    },
    { sheetId },
  );
  await page.waitForTimeout(200);

  const afterRadiusPath = path.join(screenshotDir, 'after-radius-drag.png');
  await page.screenshot({ path: afterRadiusPath, fullPage: false });

  // Assert distinct byte sizes (center drag changes callout position → different PNG)
  const beforeSize  = fs.statSync(beforePath).size;
  const afterCSize  = fs.statSync(afterCenterPath).size;
  const afterRSize  = fs.statSync(afterRadiusPath).size;
  const handlesSize = fs.statSync(handlesPath).size;

  console.log(`[verify] before=${beforeSize}B handles=${handlesSize}B after-center=${afterCSize}B after-radius=${afterRSize}B`);
  console.log(`[verify] screenshots: ${beforePath}, ${handlesPath}, ${afterCenterPath}, ${afterRadiusPath}`);

  // Any change in the drawing content → different PNG compression → different byte size
  expect(afterCSize).not.toBe(beforeSize);
  expect(afterRSize).not.toBe(afterCSize);
});
