import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export async function waitForKernelReady(page: Page): Promise<void> {
  await expect(page.getByText('Ready')).toBeVisible({ timeout: 120_000 });
}

export async function buildBox(
  page: Page,
  opts: { width: number; height: number; depth: number }
): Promise<void> {
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();

  await page.getByRole('tab', { name: 'Sketch' }).click();
  await page.getByRole('button', { name: '2D Sketch' }).click();
  await page.getByRole('button', { name: 'Numeric rectangle…' }).click();
  await page.getByLabel('x1').fill('0');
  await page.getByLabel('y1').fill('0');
  await page.getByLabel('x2').fill(String(opts.width));
  await page.getByLabel('y2').fill(String(opts.height));
  await page.getByRole('button', { name: 'OK' }).click();
  await page.getByRole('button', { name: 'Finish Sketch' }).click();

  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'Extrude' }).click();
  await page.getByLabel('Distance').fill(String(opts.depth));
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByText(/Extrusion1/)).toBeVisible();
  await expect(page.locator('[data-triangle-count]')).toHaveAttribute(
    'data-triangle-count',
    /[1-9]\d*/
  );
}
