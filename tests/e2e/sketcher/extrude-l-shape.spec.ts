import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('Extrude an L-shape drawn from 6 lines', async ({ page }) => {
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

  // L-shape corner points (screen coordinates). 6 segments wrapping back to start.
  const pts: Array<[number, number]> = [
    [cx,       cy       ],
    [cx + 100, cy       ],
    [cx + 100, cy - 50  ],
    [cx + 150, cy - 50  ],
    [cx + 150, cy - 100 ],
    [cx,       cy - 100 ]
  ];

  // LineTool commits every 2 clicks; endpoint snap brings consecutive segments together.
  // 6 segments = 12 clicks (each line is: click start, click end).
  // Move the mouse away between clicks so each pointerdown is clearly distinct
  // and the async AddPrimitiveCommand has time to settle.
  const clickAt = async (x: number, y: number): Promise<void> => {
    await page.mouse.move(x + 5, y + 5);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();
  };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    await clickAt(a[0], a[1]);
    await clickAt(b[0], b[1]);
    await expect(page.locator('[data-sketch-primitive-count]')).toHaveAttribute('data-sketch-primitive-count', String(i + 1), { timeout: 5000 });
  }

  await page.getByRole('button', { name: 'Finish Sketch' }).click();

  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'Extrude' }).click();
  await page.getByLabel('Distance').fill('50');
  await page.getByRole('button', { name: 'OK' }).click();

  await expect(page.locator('[data-triangle-count]')).toHaveAttribute('data-triangle-count', /[1-9]\d*/, { timeout: 15_000 });
});
