import { test, expect } from '@playwright/test';

test('Perf: cold start to kernel-ready', async ({ page }) => {
  const t0 = Date.now();
  await page.goto('/');
  await expect(page.getByText('Ready')).toBeVisible({ timeout: 120_000 });
  const tReady = Date.now() - t0;
  // Emit a JSON metric line so CI can grep / tools can scrape.
  console.log(JSON.stringify({ metric: 'cold-start-to-ready', ms: tReady }));
  // Generous CI budget — target on real hardware is <5s, CI can be slower.
  expect(tReady).toBeLessThan(30_000);
});
