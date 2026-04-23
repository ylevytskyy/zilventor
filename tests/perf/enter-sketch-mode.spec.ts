import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../e2e/helpers/buildBox';

test('Perf: enter sketch mode under 600 ms (3× spec budget)', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);

  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await page.getByRole('tab', { name: 'Sketch' }).click();

  const t0 = Date.now();
  await page.getByRole('button', { name: '2D Sketch' }).click();
  await expect(page.getByRole('button', { name: 'Finish Sketch' })).toBeVisible();
  const dt = Date.now() - t0;
  console.log(JSON.stringify({ metric: 'enter-sketch-mode', ms: dt }));
  // Spec §9.1 budget: 200 ms; 3× headroom for CI variance.
  expect(dt).toBeLessThan(600);
});
