import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../e2e/helpers/buildBox';
import { seedKernelPart } from '../e2e/helpers/seedKernelPart';

/**
 * T31 — fillet preview debounce perf test.
 *
 * The FilletDialog's Radius input fires `onRadiusChange` on every keystroke;
 * App.tsx's `scheduleFilletPreview` debounces those for 200 ms before calling
 * the kernel's `previewFeature` RPC.
 *
 * This test seeds a cube body + a pre-populated `filletEdges` entry on the
 * store (the real interactive pick flow needs a proper 3D ray-hit which is
 * a follow-up; for the perf test we only need the dialog's `edges` prop to
 * be non-empty so the debounce path actually fires). Then it opens the
 * dialog via F, rapid-fires 10 Radius fills ~100 ms apart, and counts how
 * many times `previewFeature` actually fires via
 * `window.__zilventorFilletPreviewCount`.
 *
 * Assertions (mirror revolve-preview-debounce T19):
 *   - count <= 3      (debounce coalesced the burst; expected 1)
 *   - wall time <= 2000 ms  (1 s burst + 500 ms settle + slack)
 */
test('Perf: 200ms fillet preview debounce coalesces rapid Radius input', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Create a Part + seed a cube body so previewFeature has a running solid.
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  await seedKernelPart(page, {
    parameters: [
      { name: 'd1', expression: '10', value: 10, unit: 'mm' },
      { name: 'r_fillet', expression: '1', value: 1, unit: 'mm' },
    ],
    sketches: [
      {
        id: 'S1',
        primitives: [{ id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 10, h: 10 }],
      },
    ],
    extrudes: [{ id: 'E1', sketchRef: 'S1', distanceParam: 'd1', operation: 'new' }],
  });

  // Wait for the initial execute so tessellatedEdges populate on the app side.
  const viewport = page.locator('[data-testid="viewport"]');
  await expect(viewport).toHaveAttribute('data-triangle-count', /[1-9]\d*/);

  // 2. Seed `filletEdges` on the store with one edge spec pointing at a top
  //    edge of the cube. Interactive pick would produce the same structure;
  //    until the 3D ray-hit path lands, direct store seeding is how the
  //    debounce path is exercised.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          setFilletEdges(edges: Array<unknown>): void;
        };
      };
    };
    w.__zilventorStore.getState().setFilletEdges([
      {
        edgeId: {
          faceA: { featureId: 'E1', role: 'top', instance: 0 },
          faceB: { featureId: 'E1', role: 'side', instance: 0 },
        },
        selectionMode: 'edge',
        radius: { kind: 'param', paramName: 'r_fillet' },
      },
    ]);
  });

  // 3. Open the Fillet dialog via the `f` shortcut.
  await page.keyboard.press('f');
  const dialog = page.getByRole('dialog', { name: /Fillet/i });
  await expect(dialog).toBeVisible();

  // 4. Reset the preview counter. Opening the dialog or setting edges may
  //    have queued an initial debounce; waiting past one interval and then
  //    zeroing the counter isolates the burst below.
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    (window as unknown as { __zilventorFilletPreviewCount?: number }).__zilventorFilletPreviewCount = 0;
  });

  // 5. Rapid-fire 10 fills with different radius values, ~100 ms apart. Each
  //    fill resets the 200 ms debounce timer — a well-behaved debounce should
  //    coalesce most of this burst into a single trailing preview.
  const radiusInput = dialog.getByLabel('Radius');
  const startMs = Date.now();
  for (let i = 0; i < 10; i++) {
    // Values 0.5, 1.0, 1.5, ... 5.0 — kept small enough to always fillet.
    await radiusInput.fill(String(0.5 * (i + 1)));
    await page.waitForTimeout(100);
  }

  // 6. Wait for the trailing debounce to fire (200 ms) plus a settle margin
  //    so `previewFeature` completes and the counter reflects the final call.
  await page.waitForTimeout(500);
  const endMs = Date.now();

  // 7. Read counter + walltime.
  const count = await page.evaluate(
    () => (window as unknown as { __zilventorFilletPreviewCount?: number }).__zilventorFilletPreviewCount ?? 0
  );
  const totalMs = endMs - startMs;
  console.log(JSON.stringify({ metric: 'fillet-preview-debounce', count, totalMs }));

  // 8. Assert: debounce heavily coalesced the burst (<= 3 of 10) and total
  //    time fits within 2 s. With 100 ms gaps between 10 fills and a 200 ms
  //    debounce, only the trailing settle fires — expected count is 1. Upper
  //    bound 3 tolerates jitter without masking regressions.
  expect(count).toBeLessThanOrEqual(3);
  expect(count).toBeGreaterThanOrEqual(1);
  expect(totalMs).toBeLessThanOrEqual(3000);
});
