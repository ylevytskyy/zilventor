// tests/perf/drawing-dxf.perf.spec.ts
import { test, expect } from '@playwright/test';

/**
 * Perf T63k — DXF export: renderDrawingDxf p95 < 50ms
 *
 * The app exposes window.__zilventorRenderDxfMs(n) in dev mode (wired in App.tsx).
 * Fixture: 4-view synthetic drawing (base + section + detail + projected).
 * Budget: p95 < 50ms. DXF string-building is pure JS with no kernel call.
 */
test('T63k Perf: renderDrawingDxf 30-iter p95 < 50ms', async ({ page }) => {
  await page.goto('/');

  await page.waitForFunction(
    () => typeof (window as { __zilventorRenderDxfMs?: unknown }).__zilventorRenderDxfMs === 'function',
    undefined,
    { timeout: 30_000 },
  ).catch(() => {
    throw new Error(
      'DXF perf wiring incomplete: window.__zilventorRenderDxfMs is not a function. ' +
      'Wire the probe in App.tsx alongside __zilventorRenderSheetMs.',
    );
  });

  const p95 = await page.evaluate(
    () => (window as { __zilventorRenderDxfMs?: (n: number) => number }).__zilventorRenderDxfMs!(30),
  );

  console.log(`[perf] T63k renderDrawingDxf p95 = ${p95.toFixed(2)} ms (budget 50ms)`);
  expect(p95).toBeLessThan(50);
});
