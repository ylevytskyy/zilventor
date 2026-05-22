// tests/perf/auto-dim.perf.spec.ts
import { test, expect } from '@playwright/test';

/**
 * Perf — Drawing F4 auto-dim (AutoDimCommand.apply(); no kernel call).
 *
 * Runs 50 iterations of AutoDimCommand.apply() + revert() against a synthetic
 * fixture: 20 dim-length constraints, 200 projected edges, 1:1 matching.
 * Budget: p95 < 200 ms.
 *
 * The probe window.__zilventorAutoDimMs(n) is wired in App.tsx (same block as
 * __zilventorBrokenViewMs). Returns { p95ms: number }.
 *
 * LOUD FAILURE: if the probe is not present on window, the test throws with a
 * clear error rather than silently passing — per F3 perf precedent.
 */
test('Perf drawing-auto-dim: AutoDimCommand p95 < 200ms', async ({ page }) => {
  await page.goto('/');

  // Hard wait for probe — loud failure if missing.
  await page.waitForFunction(
    () => typeof (window as { __zilventorAutoDimMs?: unknown }).__zilventorAutoDimMs === 'function',
    undefined,
    { timeout: 30_000 },
  ).catch(() => {
    throw new Error(
      'Batch 3 perf wiring incomplete: window.__zilventorAutoDimMs is not a function. ' +
      'Wire the probe in App.tsx after __zilventorBrokenViewMs (see Task 3.5).',
    );
  });

  const result = await page.evaluate(
    () =>
      (window as {
        __zilventorAutoDimMs?: (n: number) => Promise<{ p95ms: number }>;
      }).__zilventorAutoDimMs!(50),
  );

  const { p95ms } = result;
  console.log(`[perf] auto-dim AutoDimCommand p95 = ${p95ms.toFixed(2)} ms (budget 200ms)`);
  expect(p95ms).toBeLessThan(200);
});
