import { test, expect } from '@playwright/test';
import { buildBox, waitForKernelReady } from '../e2e/helpers/buildBox';

test('Perf: extrude box timing', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);

  const t0 = Date.now();
  await buildBox(page, { width: 100, height: 200, depth: 50 });
  const tBuild = Date.now() - t0;
  console.log(JSON.stringify({ metric: 'build-box-total', ms: tBuild }));
  expect(tBuild).toBeLessThan(10_000);
});
