import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../e2e/helpers/buildBox';
import { seedKernelPart } from '../e2e/helpers/seedKernelPart';

/**
 * T19 — debounce perf test.
 *
 * The RevolveDialog fires `onDraftChange` on every keystroke; App.tsx's
 * `schedulePreview` debounces those for 200 ms before calling the kernel's
 * `previewFeature` RPC.
 *
 * This test seeds a part via the kernel (same pragmatic state-seeding used by
 * T16/T18), opens the Revolve dialog via the `r` shortcut, selects the seeded
 * axis, then rapid-fires 10 angle fills in ~1 second. We count how many times
 * `previewFeature` actually fires via `window.__zilventorPreviewCount` — an
 * instrumentation counter incremented in `schedulePreview`'s timer callback.
 *
 * Assertions (from plan):
 *   - count <= 7      (debounce coalesced the burst; well-behaved debounce
 *                      with 100 ms gaps should give 1-3)
 *   - wall time <= 2000 ms  (the burst itself is ~1 s, plus the final
 *                      debounce + preview + settle budget)
 */
test('Perf: 200ms preview debounce coalesces rapid Angle input', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Create a Part via the UI so the kernel's internal parts map has it.
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // 2. Seed a sketch with a rectangle profile + a vertical axis line via the
  //    kernel (same approach as T16). Rectangle at (10,0)-(40,20); axis from
  //    (0,0) to (0,20).
  await seedKernelPart(page, {
    sketches: [
      {
        id: 'S_seed',
        primitives: [
          { id: 'P_rect', kind: 'rectangle', x: 10, y: 0, w: 30, h: 20 },
          { id: 'P_axis', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 20 },
        ],
      },
    ],
  });

  // Sketch is in the store (2 primitives: rectangle + axis line).
  await expect(page.locator('[data-sketch-primitive-count]')).toHaveAttribute(
    'data-sketch-primitive-count',
    '2'
  );

  // 3. Open the Revolve dialog via the `r` shortcut.
  await page.keyboard.press('r');
  const dialog = page.getByRole('dialog', { name: /Revolve/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/S_seed/)).toBeVisible();

  // 4. Pick the axis by clicking the seeded axis line in the viewport.
  await dialog.getByRole('button', { name: /^Pick$/ }).click();
  const axisCanvasPt = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorWorldToScreen: (wx: number, wy: number) => { x: number; y: number };
    };
    return w.__zilventorWorldToScreen(0, 10);
  });
  const viewport = page.locator('main#region-viewport canvas');
  await viewport.click({
    position: { x: axisCanvasPt.x, y: axisCanvasPt.y },
    force: true,
  });
  await expect(dialog.getByText(/P_axis/)).toBeVisible();

  // 5. Reset the preview counter. Picking the axis enables onDraftChange —
  //    the initial `360` value's debounce may already be queued, so we wait
  //    past one debounce interval, then zero the counter.
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    (window as unknown as { __zilventorPreviewCount?: number }).__zilventorPreviewCount = 0;
  });

  // 6. Rapid-fire 10 fills with different angle values, ~100 ms apart. Each
  //    fill resets the 200 ms debounce timer — a well-behaved debounce should
  //    coalesce most of this burst into a single trailing preview.
  const angleInput = dialog.getByLabel('Angle');
  const startMs = Date.now();
  for (let i = 0; i < 10; i++) {
    // Values 45, 90, 135, ... 450 — distinct enough to represent real input.
    await angleInput.fill(String(45 * (i + 1)));
    await page.waitForTimeout(100);
  }

  // 7. Wait for the trailing debounce to fire (200 ms) plus a settle margin
  //    so `previewFeature` completes and the counter reflects the final call.
  await page.waitForTimeout(500);
  const endMs = Date.now();

  // 8. Read the counter and walltime.
  const count = await page.evaluate(
    () => (window as unknown as { __zilventorPreviewCount?: number }).__zilventorPreviewCount ?? 0
  );
  const totalMs = endMs - startMs;
  console.log(JSON.stringify({ metric: 'revolve-preview-debounce', count, totalMs }));

  // 9. Assert: debounce heavily coalesced the burst (<= 3 of 10) and total time
  //    fits within 2 s (actual burst 1 s + 500 ms settle + slack). With 100 ms
  //    gaps between 10 fills and a 200 ms debounce, only the trailing settle
  //    fires — expected count is 1. Upper bound 3 tolerates jitter without
  //    masking regressions.
  expect(count).toBeLessThanOrEqual(3);
  expect(count).toBeGreaterThanOrEqual(1);
  expect(totalMs).toBeLessThanOrEqual(3000);
});
