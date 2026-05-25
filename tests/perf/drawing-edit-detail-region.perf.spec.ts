// tests/perf/drawing-edit-detail-region.perf.spec.ts
import { test, expect } from '@playwright/test';

/**
 * Perf — Drawing F2.4 edit-detail-region re-clip.
 *
 * Runs 100 iterations of projectDetailView (same function used by updateDetailRegionLive)
 * against a ~200-edge parent fixture. Reuses the existing __zilventorDetailViewMs harness
 * since reprojectDetailRegion calls the same projectDetailView function.
 * Budget: p95 < 50 ms (matches drawing-detail.perf.spec.ts budget).
 *
 * T63e naming consistent with existing T63-series perf tests.
 */
test('T63e Perf: editDetailRegion re-clip 100-iter p95 < 50ms', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof (window as { __zilventorDetailViewMs?: unknown }).__zilventorDetailViewMs === 'function',
    undefined,
    { timeout: 30_000 },
  );
  const result = await page.evaluate(
    () =>
      (window as {
        __zilventorDetailViewMs?: (n: number) => Promise<{ p95ms: number }>;
      }).__zilventorDetailViewMs!(100),
  );
  const { p95ms } = result;
  console.log(`[perf] T63e edit-detail-region re-clip p95 = ${p95ms.toFixed(2)} ms (budget 50ms)`);
  expect(p95ms).toBeLessThan(50);
});
