import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../e2e/helpers/buildBox';
import { seedKernelPart } from '../e2e/helpers/seedKernelPart';

/**
 * T30 — hole preview debounce perf test.
 *
 * The HoleDialog's Diameter input fires `onDraftChange` on every keystroke;
 * App.tsx's `scheduleHolePreview` debounces those for 150 ms before calling
 * the kernel's `previewFeature` RPC.
 *
 * This test seeds a box body + a holeSketchId on the store (the real
 * interactive pick flow needs a proper 3D ray-hit which is a follow-up; for
 * the perf test we only need the dialog's sketchId to be non-null so the
 * debounce path actually fires). Then it opens the dialog via H, rapid-fires
 * 10 Diameter fills ~100 ms apart, and counts how many times `previewFeature`
 * actually fires via `window.__zilventorHolePreviewCount` — an instrumentation
 * counter in App.tsx's `scheduleHolePreview` timer callback.
 *
 * IMPORTANT: holeSketchId must be seeded AFTER pressing h, because
 * OpenHoleDialogCommand calls resetHoleDialog() which clears holeSketchId.
 *
 * Assertions (mirror fillet-preview-debounce T31):
 *   - count >= 1      (at least one preview fired)
 *   - count <= 3      (debounce coalesced the burst; expected 1)
 *   - wall time <= 3000 ms  (1 s burst + 500 ms settle + slack)
 */
test('Perf: 150ms hole preview debounce coalesces rapid Diameter input', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Create a Part + seed a box body so previewFeature has a running solid.
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  await seedKernelPart(page, {
    parameters: [
      { name: 'd1', expression: '10', value: 10, unit: 'mm' },
    ],
    sketches: [
      {
        id: 'S1',
        primitives: [{ id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 20, h: 20 }],
      },
    ],
    extrudes: [{ id: 'E1', sketchRef: 'S1', distanceParam: 'd1', operation: 'new' }],
  });

  // 2. Add circle sketch so the hole placement is valid (fromSketch with S2).
  await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          kernel: { addFeature(partId: string, feature: unknown): Promise<void> };
          activePart: { id: string } | null;
        };
      };
    };
    const s = w.__zilventorStore.getState();
    await s.kernel.addFeature(s.activePart!.id, {
      kind: 'sketch',
      id: 'S2',
      plane: 'XY',
      primitives: [{ id: 'C1', kind: 'circle', cx: 10, cy: 10, r: 1 }],
      constraints: [],
    });
  });

  // Wait for initial execute to settle.
  const viewport = page.locator('[data-testid="viewport"]');
  await expect(viewport).toHaveAttribute('data-triangle-count', /[1-9]\d*/);

  // 3. Open the Hole dialog via the `h` shortcut.
  //    NOTE: OpenHoleDialogCommand calls resetHoleDialog() which clears
  //    holeSketchId — so seed holeSketchId AFTER the dialog is open.
  await page.keyboard.press('h');
  const dialog = page.getByRole('dialog', { name: /Hole/i });
  await expect(dialog).toBeVisible();

  // 4. Seed holeSketchId on the store so onDraftChange produces a valid
  //    fromSketch placement (required for the preview path to fire).
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        setState(fn: (s: unknown) => unknown): void;
      };
    };
    w.__zilventorStore.setState((s: any) => ({
      ...s,
      holeSketchId: 'S2',
      holePlacementMode: 'fromSketch',
    }));
  });

  // 5. Reset the preview counter. Seeding holeSketchId triggers onDraftChange
  //    which queues an initial debounced preview; wait past one interval then
  //    zero the counter to isolate the burst below.
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    (window as unknown as { __zilventorHolePreviewCount?: number }).__zilventorHolePreviewCount = 0;
  });

  // 6. Rapid-fire 10 fills with different diameter values, ~100 ms apart. Each
  //    fill resets the 150 ms debounce timer — a well-behaved debounce should
  //    coalesce most of this burst into a single trailing preview.
  const diameterInput = dialog.getByLabel('Diameter');
  const startMs = Date.now();
  for (let i = 1; i <= 10; i++) {
    // Values 1, 2, 3, ... 10 mm
    await diameterInput.fill(String(i));
    await page.waitForTimeout(100);
  }

  // 7. Wait for the trailing debounce to fire (150 ms) plus a settle margin.
  await page.waitForTimeout(500);
  const endMs = Date.now();

  // 8. Read counter + walltime.
  const count = await page.evaluate(
    () => (window as unknown as { __zilventorHolePreviewCount?: number }).__zilventorHolePreviewCount ?? 0
  );
  const totalMs = endMs - startMs;
  console.log(JSON.stringify({ metric: 'hole-preview-debounce', count, totalMs }));

  // 9. Assert: debounce heavily coalesced the burst (<= 3 of 10) and total
  //    time fits within 3 s. With 100 ms gaps between 10 fills and a 150 ms
  //    debounce, only the trailing settle fires — expected count is 1. Upper
  //    bound 3 tolerates jitter without masking regressions.
  expect(count).toBeGreaterThanOrEqual(1);
  expect(count).toBeLessThanOrEqual(3);
  expect(totalMs).toBeLessThanOrEqual(3000);
});
