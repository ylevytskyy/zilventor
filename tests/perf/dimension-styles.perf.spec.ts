// tests/perf/dimension-styles.perf.spec.ts
import { test, expect } from '@playwright/test';

/**
 * Perf — Drawing F5 dimension styles (renderDrawingSvg for baseline/ordinate/angular).
 *
 * Runs 50 iterations of renderDrawingSvg against a synthetic fixture:
 * 10 baseline dims + 10 ordinate dims (5x + 5y) + 10 angular dims (two-edges).
 * 30 dims total; budget: p95 < 200 ms.
 *
 * The probe window.__zilventorDimensionStylesMs(n) is wired in App.tsx
 * after __zilventorAutoDimMs. Returns { p95ms: number }.
 *
 * LOUD FAILURE: if the probe is not present on window, the test throws with a
 * clear error rather than silently passing — per F4 perf precedent.
 */
test('Perf drawing-dimension-styles: renderDrawingSvg p95 < 200ms', async ({ page }) => {
  await page.goto('/');

  // Hard wait for probe — loud failure if missing.
  await page.waitForFunction(
    () => typeof (window as { __zilventorDimensionStylesMs?: unknown }).__zilventorDimensionStylesMs === 'function',
    undefined,
    { timeout: 30_000 },
  ).catch(() => {
    throw new Error(
      'F5 perf wiring incomplete: window.__zilventorDimensionStylesMs is not a function. ' +
      'Wire the probe in App.tsx after __zilventorAutoDimMs (see T30).',
    );
  });

  const result = await page.evaluate(
    () =>
      (window as {
        __zilventorDimensionStylesMs?: (n: number) => Promise<{ p95ms: number }>;
      }).__zilventorDimensionStylesMs!(50),
  );

  const { p95ms } = result;
  console.log(`[perf] dimension-styles renderDrawingSvg p95 = ${p95ms.toFixed(2)} ms (budget 200ms)`);
  expect(p95ms).toBeLessThan(200);
});
