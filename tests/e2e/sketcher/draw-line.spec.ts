import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('Draw a line: 2 clicks commit a primitive in the current sketch', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto('/');
  await waitForKernelReady(page);

  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await page.getByRole('tab', { name: 'Sketch' }).click();
  await page.getByRole('button', { name: '2D Sketch' }).click();
  await page.getByRole('button', { name: /^Line/i }).click();

  const viewport = page.locator('main#region-viewport canvas');
  const box = (await viewport.boundingBox())!;
  // Use locator.click with position + force so clicks target the canvas even if
  // the NumericInputOverlay (absolute-positioned, z-40) appears above it after
  // the pointer-move preview between the two clicks.
  await viewport.click({ position: { x: box.width / 2, y: box.height / 2 }, force: true });
  await viewport.click({ position: { x: box.width / 2 + 100, y: box.height / 2 }, force: true });

  // Browser pane should now show a sketch with 1 primitive
  await expect(page.locator('[data-sketch-primitive-count]')).toHaveAttribute('data-sketch-primitive-count', '1');
});
