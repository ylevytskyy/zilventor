// tests/perf/drawing-large.perf.spec.ts
import { test, expect } from '@playwright/test';

/**
 * Perf T62 — drawing-large:
 *   - Single-view projection p95 < 200 ms  (T62a)
 *   - Whole-sheet render (4 views) p95 < 100 ms  (T62b)
 *   - PDF export of 4-sheet drawing p95 < 500 ms  (T62c)
 *
 * The app exposes these window hooks in dev mode (wired in App.tsx):
 *   __zilventorProjectViewMs(n)   → p95 of single-view projection over n iterations
 *   __zilventorRenderSheetMs(n)   → p95 of 4-view sheet SVG render over n iterations
 *   __zilventorExportPdfMs(n)     → p95 of 4-sheet PDF export over n iterations
 */

test('Perf T62a: single-view projection p95 < 200 ms (50-feature part)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof (window as { __zilventorProjectViewMs?: unknown }).__zilventorProjectViewMs === 'function',
    undefined,
    { timeout: 30_000 },
  );
  const p95 = await page.evaluate(
    () => (window as { __zilventorProjectViewMs?: (n: number) => number }).__zilventorProjectViewMs!(20),
  );
  console.log(`[perf] single-view projection p95 = ${p95.toFixed(2)} ms (budget 200ms)`);
  expect(p95).toBeLessThan(200);
});

test('Perf T62b: 4-view sheet first-render p95 < 100 ms', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof (window as { __zilventorRenderSheetMs?: unknown }).__zilventorRenderSheetMs === 'function',
    undefined,
    { timeout: 30_000 },
  );
  const p95 = await page.evaluate(
    () => (window as { __zilventorRenderSheetMs?: (n: number) => number }).__zilventorRenderSheetMs!(20),
  );
  console.log(`[perf] 4-view sheet render p95 = ${p95.toFixed(2)} ms (budget 100ms)`);
  expect(p95).toBeLessThan(100);
});

test('Perf T62c: PDF export of 4-sheet drawing p95 < 500 ms', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof (window as { __zilventorExportPdfMs?: unknown }).__zilventorExportPdfMs === 'function',
    undefined,
    { timeout: 30_000 },
  );
  const p95 = await page.evaluate(
    () => (window as { __zilventorExportPdfMs?: (n: number) => number }).__zilventorExportPdfMs!(20),
  );
  console.log(`[perf] 4-sheet PDF export p95 = ${p95.toFixed(2)} ms (budget 500ms)`);
  expect(p95).toBeLessThan(500);
});
