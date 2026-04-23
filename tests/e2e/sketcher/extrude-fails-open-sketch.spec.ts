import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('Extrude fails with "not closed" message for an open polyline', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);

  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await page.getByRole('tab', { name: 'Sketch' }).click();
  await page.getByRole('button', { name: '2D Sketch' }).click();
  await page.getByRole('button', { name: /^Line/i }).click();

  const viewport = page.locator('main#region-viewport canvas');
  const box = (await viewport.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Three DISCONNECTED line segments — no endpoint sharing.
  const segments: Array<[[number, number], [number, number]]> = [
    [[cx - 100, cy - 100], [cx - 50, cy - 100]],
    [[cx + 50,  cy - 100], [cx + 100, cy - 100]],
    [[cx - 100, cy - 50 ], [cx - 50, cy - 50 ]]
  ];
  for (let i = 0; i < segments.length; i++) {
    const [a, b] = segments[i]!;
    await page.mouse.click(a[0], a[1]);
    await page.mouse.click(b[0], b[1]);
    await expect(page.locator('[data-sketch-primitive-count]')).toHaveAttribute('data-sketch-primitive-count', String(i + 1), { timeout: 5000 });
  }

  await page.getByRole('button', { name: 'Finish Sketch' }).click();

  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'Extrude' }).click();
  await page.getByLabel('Distance').fill('50');
  await page.getByRole('button', { name: 'OK' }).click();

  await expect(page.getByText(/not closed|disconnected line/i)).toBeVisible({ timeout: 10_000 });
});
