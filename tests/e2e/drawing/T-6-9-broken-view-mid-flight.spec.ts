// tests/e2e/drawing/T-6-9-broken-view-mid-flight.spec.ts
/**
 * Mid-flight Playwright verification for Batch 4 of Drawing F3 — Broken Views.
 * Not the full T-6-9 spec (that lives in Batch 5).
 *
 * Verifies:
 *   (a) Ribbon "Add Break" button is visible and disabled on a drawing with no projection
 *   (b) After injecting a broken base view, at least one break-symbol polyline renders
 *   (c) break-symbol polyline has data-role="break-symbol"
 *
 * Uses store injection (no real kernel call / canvas click) to isolate UI rendering.
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedDrawingWithBoxPart } from '../helpers/seedDrawing';

test('T-6-9-mid-flight: broken-view UI — ribbon button + break-symbol render + screenshot', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Seed a drawing with no views.
  const { sheetId } = await seedDrawingWithBoxPart(page, {
    boxLength: 200, boxWidth: 60, boxHeight: 40,
    sheetSize: 'A3', orientation: 'landscape',
  });

  // 2. Switch to Drawing tab.
  await page.getByRole('tab', { name: 'Drawing' }).click();

  // 3. Assert "Add Break" ribbon button is visible (Batch 4 ribbon change).
  const addBreakBtn = page.getByRole('button', { name: /add break/i });
  await expect(addBreakBtn).toBeVisible({ timeout: 10_000 });
  // Should be disabled with no projection
  await expect(addBreakBtn).toBeDisabled();

  // 4. Inject a base view with a break-symbol edge directly via store.
  const viewId = 'T69-mid-base';
  await page.evaluate(
    ({ sheetId, viewId }: { sheetId: string; viewId: string }) => {
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

      // Synthetic zigzag break symbol points (simplified sawtooth along Y)
      const zigzagPts: [number, number][] = [];
      for (let i = 0; i <= 60; i += 3) {
        const t0 = i;
        const t1 = i + 0.75;
        const t2 = i + 2.25;
        const t3 = i + 3;
        const spine = 105; // after-break position in view-local mm
        zigzagPts.push([spine, t0], [spine + 1.5, t1], [spine - 1.5, t2], [spine, t3]);
      }

      const baseView = {
        id: viewId, kind: 'base',
        positionMm: { x: 40, y: 80 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front', showHidden: false,
        breaks: [{ id: 'br1', axis: 'x', coordA: 50, coordB: 150, gapMm: 5, style: 'zigzag' }],
        rawProjection: {
          visibleEdges: [{ id: 'T69-raw-e0', kind: 'outline', points: [[0, 0], [200, 0], [200, 40], [0, 40], [0, 0]] }],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 200, maxY: 40 },
        },
        projection: {
          visibleEdges: [
            // Before-band fragment
            { id: 'T69-e0_a', kind: 'outline', points: [[0, 0], [50, 0]] },
            // After-band fragment (compressed)
            { id: 'T69-e0_b', kind: 'outline', points: [[55, 0], [105, 0]] },
            // Break symbol zigzag
            { id: 'break_br1', kind: 'break', points: zigzagPts },
          ],
          hiddenEdges: [],
          bbox: { minX: 0, minY: -5, maxX: 110, maxY: 45 },
        },
        inputFingerprint: 'fp-T69-mid',
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
    { sheetId, viewId },
  );

  // 5. Assert: view is visible in canvas.
  await expect(page.locator(`g[data-view-id="${viewId}"]`)).toBeVisible({ timeout: 10_000 });

  // 6. Assert: at least one break-symbol polyline rendered.
  const breakSymbol = page.locator(`g[data-view-id="${viewId}"] polyline[data-role="break-symbol"]`);
  await expect(breakSymbol.first()).toBeAttached({ timeout: 5_000 });

  // 7. Assert: "Add Break" button now enabled (breakable view with projection exists).
  await expect(addBreakBtn).not.toBeDisabled({ timeout: 3_000 });

  // 8. Capture screenshot proof.
  await page.screenshot({ path: '/tmp/drawing-broken-mid-flight.png' });
  console.log('Screenshot captured: /tmp/drawing-broken-mid-flight.png');
});
