// tests/perf/drawing-broken.perf.spec.ts
import { test, expect } from '@playwright/test';

/**
 * Perf — Drawing F3 broken-view applyBreaks (pure 2D clip + translate; no kernel call).
 *
 * Runs 100 iterations of applyBreaks against a 1 000-edge synthetic fixture
 * (10 axis-aligned + 990 random oblique edges, 2 x-axis breaks).
 * Budget: p95 < 50 ms.
 *
 * The app exposes window.__zilventorBrokenViewMs(n) in dev mode (wired in App.tsx,
 * same block as __zilventorDetailViewMs).  Returns { p95ms: number }.
 */
test('Perf drawing-broken: applyBreaks 100-iter p95 < 50ms', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof (window as { __zilventorBrokenViewMs?: unknown }).__zilventorBrokenViewMs === 'function',
    undefined,
    { timeout: 30_000 },
  );
  const result = await page.evaluate(
    () =>
      (window as {
        __zilventorBrokenViewMs?: (n: number) => Promise<{ p95ms: number }>;
      }).__zilventorBrokenViewMs!(100),
  );
  const { p95ms } = result;
  console.log(`[perf] broken-view applyBreaks p95 = ${p95ms.toFixed(2)} ms (budget 50ms)`);
  expect(p95ms).toBeLessThan(50);
});
