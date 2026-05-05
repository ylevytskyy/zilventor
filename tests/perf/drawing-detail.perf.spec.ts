// tests/perf/drawing-detail.perf.spec.ts
import { test, expect } from '@playwright/test';

/**
 * Perf — Drawing F2 detail-view creation (pure 2D clip + transform; no kernel call).
 *
 * Runs 100 iterations of projectDetailView against a ~200-edge parent fixture.
 * Budget: p95 < 50 ms.
 *
 * The app exposes window.__zilventorDetailViewMs(n) in dev mode (wired in App.tsx).
 * It returns { p95ms: number }.
 */
test('Perf drawing-detail: AddDetailView clip+transform 100-iter p95 < 50ms', async ({ page }) => {
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
  console.log(`[perf] detail-view clip+transform p95 = ${p95ms.toFixed(2)} ms (budget 50ms)`);
  expect(p95ms).toBeLessThan(50);
});
