import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('place a linear dimension on a line', async ({ page }) => {
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
  await viewport.click({ position: { x: box.width / 2 - 100, y: box.height / 2 }, force: true });
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2);
  await viewport.click({ position: { x: box.width / 2 + 100, y: box.height / 2 }, force: true });
  await expect(page.locator('[data-sketch-primitive-count]')).toHaveAttribute('data-sketch-primitive-count', '1');

  await page.keyboard.press('d');
  // Offset 70 px right of the line midpoint to avoid the auto-inferred
  // H-badge that sits at the midpoint with pointerEvents: 'auto'.
  await viewport.click({ position: { x: box.width / 2 + 70, y: box.height / 2 }, force: true });

  await expect(page.getByRole('dialog', { name: /Edit Dimension/i })).toBeVisible();
  await page.getByLabel('Value').fill('50');
  await page.getByRole('button', { name: /^OK$/ }).click();

  // Dimension glyph renders with "50.00" label; sketch becomes fully constrained.
  await expect(page.locator('svg >> text="50.00"')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('footer')).toContainText(/Fully constrained|DOF/);
});
