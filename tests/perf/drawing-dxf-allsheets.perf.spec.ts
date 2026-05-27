// tests/perf/drawing-dxf-allsheets.perf.spec.ts
import { test, expect } from '@playwright/test';

/**
 * Perf T63m — All-sheets DXF render+zip p95 < 50ms.
 *
 * window.__zilventorAllSheetsDxfMs(n) is wired in App.tsx (dev mode).
 * Fixture: 8-sheet drawing, 2 views per sheet, full WYSIWYG render + buildDxfZip.
 * Budget: p95 < 50ms (pure JS string-building + synchronous zipSync — same class as T63l).
 */
test('T63m Perf: all-sheets DXF render+zip (8 sheets) 30-iter p95 < 50ms', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof (window as { __zilventorAllSheetsDxfMs?: unknown }).__zilventorAllSheetsDxfMs === 'function',
    undefined, { timeout: 30_000 },
  ).catch(() => { throw new Error('All-sheets DXF perf wiring incomplete: window.__zilventorAllSheetsDxfMs is not a function.'); });

  const p95 = await page.evaluate(
    () => (window as { __zilventorAllSheetsDxfMs?: (n: number) => number }).__zilventorAllSheetsDxfMs!(30),
  );
  console.log(`[perf] T63m all-sheets DXF render+zip p95 = ${p95.toFixed(2)} ms (budget 50ms)`);
  expect(p95).toBeLessThan(50);
});
