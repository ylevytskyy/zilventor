import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../e2e/helpers/buildBox';

test('Perf: draw 20 primitives in under 15 s', async ({ page }) => {
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

  const clickAt = async (x: number, y: number): Promise<void> => {
    await page.mouse.move(x + 5, y + 5);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();
  };

  const t0 = Date.now();
  for (let i = 0; i < 20; i++) {
    const baseX = cx + (i % 5) * 40;
    const baseY = cy + Math.floor(i / 5) * 40;
    await clickAt(baseX, baseY);
    await clickAt(baseX + 20, baseY + 20);
    await expect(page.locator('[data-sketch-primitive-count]')).toHaveAttribute(
      'data-sketch-primitive-count',
      String(i + 1),
      { timeout: 3000 }
    );
  }
  const dt = Date.now() - t0;
  console.log(JSON.stringify({ metric: 'draw-20-primitives', ms: dt }));
  // Realistic ceiling — inner loop is kernel RPC + re-render.
  expect(dt).toBeLessThan(15_000);
});
