// tests/perf/drawing-rect-detail.perf.spec.ts
import { test, expect } from '@playwright/test';

/**
 * Perf — Drawing F2.1 rect-detail-view creation (rect clip + transform; no kernel call).
 *
 * Runs 100 iterations of projectDetailView against a ~200-edge parent fixture,
 * using a rect regionParent. Budget: p95 < 50 ms (same class as drawing-detail.perf.spec.ts).
 *
 * The probe window.__zilventorRectDetailViewMs(n) is wired in App.tsx after the
 * existing __zilventorHoleTableMs probe. Returns { p95ms: number }.
 *
 * LOUD FAILURE: if the probe is absent, the test throws a clear error.
 *
 * T63g naming consistent with existing T63-series perf tests.
 */
test('T63g Perf: rect-detail clip+transform 100-iter p95 < 50ms', async ({ page }) => {
  await page.goto('/');

  await page.waitForFunction(
    () => typeof (window as { __zilventorRectDetailViewMs?: unknown }).__zilventorRectDetailViewMs === 'function',
    undefined,
    { timeout: 30_000 },
  ).catch(() => {
    throw new Error(
      'F2.1 rect-detail perf probe missing: window.__zilventorRectDetailViewMs is not a function. ' +
      'Wire the probe in App.tsx after __zilventorHoleTableMs (see Task 5.6).',
    );
  });

  const result = await page.evaluate(
    () =>
      (window as {
        __zilventorRectDetailViewMs?: (n: number) => Promise<{ p95ms: number }>;
      }).__zilventorRectDetailViewMs!(100),
  );

  const { p95ms } = result;
  console.log(`[perf] T63g rect-detail clip+transform p95 = ${p95ms.toFixed(2)} ms (budget 50ms)`);
  expect(p95ms).toBeLessThan(50);
});
