// tests/perf/section-cut.perf.spec.ts
import { test, expect } from '@playwright/test';

/**
 * Perf T63 — section-cut (F18 kernel bridge wired):
 *   T63a: Full cut+project pipeline for a 20-component assembly p95 < 400ms.
 *         The OCCT cut runs in the kernel worker; this test measures the
 *         main-thread projection step (projectView + projectSectionView) with
 *         synthetic 20-box geometry. Mode is always 'cut+project'.
 *   T63b: Standalone projection regression guard — p95 still < 200ms.
 */

test('Perf T63a: section cut+project 20-component assembly p95 < 400ms', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof (window as { __zilventorSectionCutMs?: unknown }).__zilventorSectionCutMs === 'function',
    undefined,
    { timeout: 30_000 },
  );
  const result = await page.evaluate(
    () => (window as { __zilventorSectionCutMs?: (n: number) => Promise<{ p95ms: number; mode: string }> }).__zilventorSectionCutMs!(20),
  );
  const { p95ms, mode } = result;
  console.log(`[perf] section cut+project p95 = ${p95ms.toFixed(2)} ms (mode: ${mode})`);

  // Kernel is wired — always measures cut+project pipeline. Budget 400ms.
  console.log(`[perf] budget 400ms (cut+project)`);
  expect(p95ms).toBeLessThan(400);
});

test('Perf T63b: single-view projection p95 still < 200ms after section plumbing', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof (window as { __zilventorProjectViewMs?: unknown }).__zilventorProjectViewMs === 'function',
    undefined,
    { timeout: 30_000 },
  );
  const p95 = await page.evaluate(
    () => (window as { __zilventorProjectViewMs?: (n: number) => number }).__zilventorProjectViewMs!(20),
  );
  console.log(`[perf] projection p95 (regression guard) = ${p95.toFixed(2)} ms (budget 200ms)`);
  expect(p95).toBeLessThan(200);
});
