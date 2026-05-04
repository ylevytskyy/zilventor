import { test, expect } from '@playwright/test';

test('Perf T33: packAllMaterials p95 < 50 ms for 200-panel single-material nest', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof (window as { __zilventorNestPackMs?: unknown }).__zilventorNestPackMs === 'function');
  const p95 = await page.evaluate(() => (window as { __zilventorNestPackMs?: (n: number) => number }).__zilventorNestPackMs!(20));
  console.log(`[perf] nest-large p95 = ${p95.toFixed(2)} ms (budget 50ms)`);
  expect(p95).toBeLessThan(50);
});
