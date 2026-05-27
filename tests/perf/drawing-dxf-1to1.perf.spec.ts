// tests/perf/drawing-dxf-1to1.perf.spec.ts
import { test, expect } from '@playwright/test';

/**
 * Perf T63l — DXF 1:1 export: renderDrawingDxf1to1 p95 < 50ms.
 * window.__zilventorRenderDxf1to1Ms(n) is wired in App.tsx (dev mode).
 */
test('T63l Perf: renderDrawingDxf1to1 30-iter p95 < 50ms', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof (window as { __zilventorRenderDxf1to1Ms?: unknown }).__zilventorRenderDxf1to1Ms === 'function',
    undefined, { timeout: 30_000 },
  ).catch(() => { throw new Error('1:1 DXF perf wiring incomplete: window.__zilventorRenderDxf1to1Ms is not a function.'); });

  const p95 = await page.evaluate(
    () => (window as { __zilventorRenderDxf1to1Ms?: (n: number) => number }).__zilventorRenderDxf1to1Ms!(30),
  );
  console.log(`[perf] T63l renderDrawingDxf1to1 p95 = ${p95.toFixed(2)} ms (budget 50ms)`);
  expect(p95).toBeLessThan(50);
});
