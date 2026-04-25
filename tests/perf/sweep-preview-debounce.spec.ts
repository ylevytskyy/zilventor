import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../e2e/helpers/buildBox';

/**
 * T28 — sweep preview debounce perf test.
 *
 * The SweepDialog fires `onDraftChange` (via store setState) whenever sweep
 * state changes; App.tsx's `scheduleSweepPreview` debounces those for 150 ms
 * before calling the kernel's `previewFeature` RPC.
 *
 * This test seeds profile + path sketches, opens the Sweep dialog via the `w`
 * shortcut, seeds sweepProfileSketchId / sweepPathSketchId AFTER the dialog
 * opens (OpenSweepDialogCommand calls resetSweepDialog which clears them),
 * then rapid-fires 10 orientation toggles within ~10 ms. We count how many
 * times `previewFeature` actually fires via `window.__zilventorSweepPreviewCount`
 * — the instrumentation counter in App.tsx's scheduleSweepPreview callback.
 *
 * Assertions (mirror hole-preview-debounce T30 / fillet-preview-debounce T31):
 *   - count >= 1      (at least one preview fired)
 *   - count <= 3      (debounce coalesced the burst; expected 1)
 *   - wall time <= 3000 ms
 */
test('Perf: 150ms sweep preview debounce coalesces rapid orientation changes', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Create a Part via the UI so the kernel's internal parts map has it.
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // 2. Seed profile (circle) and path (line) sketches via kernel API directly,
  //    because circle is not in SeedSketchPrimitive.
  await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          kernel: {
            addFeature(partId: string, feature: unknown): Promise<void>;
            execute(partId: string): Promise<unknown>;
            getPart(partId: string): Promise<unknown>;
          };
          activePart: { id: string } | null;
          setActivePart(p: unknown): void;
        };
      };
    };
    const s = w.__zilventorStore.getState();
    await s.kernel.addFeature(s.activePart!.id, {
      kind: 'sketch',
      id: 'PROF',
      plane: 'XY',
      primitives: [{ id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 1 }],
      constraints: [],
    });
    await s.kernel.addFeature(s.activePart!.id, {
      kind: 'sketch',
      id: 'PATH',
      plane: 'XZ',
      primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }],
      constraints: [],
    });
    await s.kernel.execute(s.activePart!.id);
    const next = await s.kernel.getPart(s.activePart!.id);
    s.setActivePart(next);
  });

  // 3. Open the Sweep dialog via the `w` shortcut.
  //    NOTE: OpenSweepDialogCommand calls resetSweepDialog() which clears
  //    sweepProfileSketchId / sweepPathSketchId — so seed them AFTER the dialog
  //    is open.
  await page.keyboard.press('w');
  const dialog = page.getByRole('dialog', { name: /Sweep/i });
  await expect(dialog).toBeVisible();

  // 4. Seed profile + path sketch IDs on the store so the preview path fires.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        setState(fn: (s: unknown) => unknown): void;
      };
    };
    w.__zilventorStore.setState((s: any) => ({
      ...s,
      sweepProfileSketchId: 'PROF',
      sweepPathSketchId: 'PATH',
      sweepOrientationKind: 'path',
    }));
  });

  // 5. Wait for the initial debounce to settle, then zero the counter so the
  //    burst measurement below is isolated.
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    (window as unknown as { __zilventorSweepPreviewCount?: number }).__zilventorSweepPreviewCount = 0;
  });

  // 6. Rapid-fire 10 orientation toggles with no delay between them.
  //    All 10 arrive within ~10 ms — the 150 ms debounce should coalesce them
  //    into a single trailing preview call.
  const startMs = Date.now();
  for (let i = 0; i < 10; i++) {
    await page.evaluate((kind: any) => {
      (window as unknown as {
        __zilventorStore: { setState(fn: (s: unknown) => unknown): void };
      }).__zilventorStore.setState((s: any) => ({
        ...s,
        sweepOrientationKind: kind,
      }));
    }, i % 2 === 0 ? 'parallel' : 'path');
  }

  // 7. Wait for the trailing debounce to fire (150 ms) plus a settle margin.
  await page.waitForTimeout(500);
  const endMs = Date.now();

  // 8. Read counter and walltime.
  const count = await page.evaluate(
    () => (window as unknown as { __zilventorSweepPreviewCount?: number }).__zilventorSweepPreviewCount ?? 0
  );
  const totalMs = endMs - startMs;
  console.log(JSON.stringify({ metric: 'sweep-preview-debounce', count, totalMs }));

  // 9. Assert: debounce heavily coalesced the burst (<= 3 of 10) and total
  //    time fits within 3 s. With 10 rapid changes and a 150 ms debounce,
  //    only the trailing settle fires — expected count is 1. Upper bound 3
  //    tolerates jitter without masking regressions.
  expect(count).toBeGreaterThanOrEqual(1);
  expect(count).toBeLessThanOrEqual(3);
  expect(totalMs).toBeLessThanOrEqual(3000);
});
