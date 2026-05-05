// tests/e2e/drawing/T-6-4-stale-banner-regen.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedDrawingWithView } from '../helpers/seedDrawing';

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

  // 1. Seed drawing with a pre-projected base view (fingerprint set).
  const { sheetId } = await seedDrawingWithView(page, {
    boxLength: 100, boxWidth: 60, boxHeight: 40,
    orientation: 'front', scale: { numerator: 1, denominator: 1 },
  });

  // 2. Mutate the view to remove its inputFingerprint (simulates source geometry change).
  await page.evaluate((sheetId: string) => {
    const w = window as unknown as {
      __zilventorStore: { getState(): {
        activeDocument?: { kind: string; document: {
          sheets: Array<{ id: string; views: Array<Record<string, unknown>> }>;
        } };
        setActiveDocument(d: unknown): void;
      } };
    };
    const s = w.__zilventorStore.getState();
    const drawing = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
    if (!drawing) return;

    const updatedSheets = drawing.sheets.map((sh) => {
      if (sh.id !== sheetId) return sh;
      return {
        ...sh,
        views: sh.views.map((v) => {
          // Remove inputFingerprint — DrawingCanvas marks these as stale on mount
          const { inputFingerprint: _fp, ...rest } = v;
          void _fp;
          return rest;
        }),
      };
    });
    s.setActiveDocument({ kind: 'drawing', document: { ...drawing, sheets: updatedSheets } });
  }, sheetId);

  // 3. Assert: [data-stale-marker] visible (DrawingCanvas detects stale views on initial render).
  await expect(page.locator('[data-stale-marker]')).toBeVisible({ timeout: 10_000 });

  // 4. Click the Regenerate button (rendered inside the stale ViewElement overlay).
  await page.getByRole('button', { name: /regenerate/i }).click();

  // 5. Assert: stale marker cleared.
  await expect(page.locator('[data-stale-marker]')).toHaveCount(0, { timeout: 10_000 });
});
