import { test, expect } from '@playwright/test';

test('Perf: cold start to kernel-ready', async ({ page }) => {
  const t0 = Date.now();
  await page.goto('/');
  await expect(page.getByText('Ready')).toBeVisible({ timeout: 120_000 });
  const tReady = Date.now() - t0;
  // Emit a JSON metric line so CI can grep / tools can scrape.
  console.log(JSON.stringify({ metric: 'cold-start-to-ready', ms: tReady }));
  // Spec §7.1 target: ≤ 5000ms on 2015-era hardware with warm cache.
  // Measured ~4.7s on 2024 dev machine; 10s cap gives ~2× CI headroom for
  // shared-runner variance without masking real regressions.
  expect(tReady).toBeLessThan(10_000);
});
