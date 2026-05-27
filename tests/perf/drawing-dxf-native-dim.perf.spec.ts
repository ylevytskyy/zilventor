// tests/perf/drawing-dxf-native-dim.perf.spec.ts
import { test, expect } from '@playwright/test';

/**
 * Perf T63n — native-dimension DXF: renderDrawingDxf on a dimension-heavy sheet, p95 < 50ms.
 * Exercises the block() + dimension() native-DIMENSION path (T63k's fixture has no dimensions).
 */
test('T63n Perf: renderDrawingDxf (dimension-heavy) 30-iter p95 < 50ms', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof (window as { __zilventorRenderDxfDimsMs?: unknown }).__zilventorRenderDxfDimsMs === 'function',
    undefined, { timeout: 30_000 },
  ).catch(() => { throw new Error('Perf wiring incomplete: window.__zilventorRenderDxfDimsMs is not a function. Wire it in App.tsx.'); });

  const p95 = await page.evaluate(
    () => (window as { __zilventorRenderDxfDimsMs?: (n: number) => number }).__zilventorRenderDxfDimsMs!(30),
  );
  console.log(`[perf] T63n renderDrawingDxf(dims) p95 = ${p95.toFixed(2)} ms (budget 50ms)`);
  expect(p95).toBeLessThan(50);
});
