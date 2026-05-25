// tests/perf/drawing-hole-table.perf.spec.ts
import { test, expect } from '@playwright/test';

/**
 * Perf — Drawing F6 hole table (computeHoleTableRows).
 *
 * Runs 100 iterations of computeHoleTableRows against a synthetic fixture:
 * 20 holes (10 of dia=8, 10 of dia=12), 2 distinct size groups.
 * Each hole's circular boundary: 16 polyline points.
 * Budget: p95 < 50 ms (same class as drawing-detail and drawing-edit-detail-region).
 * Expect microseconds in practice (pure 2D geometry, no kernel call).
 *
 * The probe window.__zilventorHoleTableMs(n) is wired in App.tsx after
 * __zilventorDimensionStylesMs. Returns { p95ms: number }.
 *
 * LOUD FAILURE: if the probe is not present on window, the test throws with a
 * clear error rather than silently passing — per F3/F4/F5 perf precedent.
 *
 * T63f naming consistent with existing T63-series perf tests.
 */
test('T63f Perf: computeHoleTableRows 100-iter p95 < 50ms', async ({ page }) => {
  await page.goto('/');

  // Hard wait for probe — loud failure if missing.
  await page.waitForFunction(
    () => typeof (window as { __zilventorHoleTableMs?: unknown }).__zilventorHoleTableMs === 'function',
    undefined,
    { timeout: 30_000 },
  ).catch(() => {
    throw new Error(
      'F6 perf wiring incomplete: window.__zilventorHoleTableMs is not a function. ' +
      'Wire the probe in App.tsx after __zilventorDimensionStylesMs (see Task 4.2).',
    );
  });

  const result = await page.evaluate(
    () =>
      (window as {
        __zilventorHoleTableMs?: (n: number) => Promise<{ p95ms: number }>;
      }).__zilventorHoleTableMs!(100),
  );

  const { p95ms } = result;
  console.log(`[perf] T63f hole-table computeHoleTableRows p95 = ${p95ms.toFixed(2)} ms (budget 50ms)`);
  expect(p95ms).toBeLessThan(50);
});
