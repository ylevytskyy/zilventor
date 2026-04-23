import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('Enter sketch mode shows primitive buttons and Finish Sketch', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);

  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();

  await page.getByRole('tab', { name: 'Sketch' }).click();
  await page.getByRole('button', { name: '2D Sketch' }).click();

  await expect(page.getByRole('button', { name: /Finish Sketch/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Line/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Rectangle/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Circle/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Arc/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Spline/i })).toBeVisible();
});
