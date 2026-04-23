import { test, expect } from '@playwright/test';
import { buildBox, waitForKernelReady } from '../e2e/helpers/buildBox';

test('Perf: extrude box timing', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);

  const t0 = Date.now();
  await buildBox(page, { width: 100, height: 200, depth: 50 });
  const tBuild = Date.now() - t0;
  console.log(JSON.stringify({ metric: 'build-box-total', ms: tBuild }));
  // Measured ~0.6–1.4s on 2024 dev machine; 5s cap gives ~3.5× CI headroom.
  // Inner single-feature extrude budget (spec §7.1) is 300ms — not asserted
  // directly here because this measures the full click-sequence round-trip.
  expect(tBuild).toBeLessThan(5_000);
});
