import { test, expect } from '@playwright/test';

test('Workflow 2 — create a box end-to-end', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Model' })).toBeVisible();
  // Wait for CAD-ready status (kernel init). Target: <5s, we allow 120s for slower dev machines.
  await expect(page.getByText('Ready')).toBeVisible({ timeout: 120_000 });

  // 1. New Part
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // 2. Enter sketch mode and draw a rectangle
  await page.getByRole('tab', { name: 'Sketch' }).click();
  await page.getByRole('button', { name: '2D Sketch' }).click();
  await page.getByRole('button', { name: 'Rectangle' }).click();
  await page.getByLabel('x1').fill('0');
  await page.getByLabel('y1').fill('0');
  await page.getByLabel('x2').fill('100');
  await page.getByLabel('y2').fill('200');
  await page.getByRole('button', { name: 'OK' }).click();

  // Browser pane should show Sketch1
  await expect(page.getByText(/Sketch1/)).toBeVisible();

  await page.getByRole('button', { name: 'Finish Sketch' }).click();

  // 3. Extrude
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'Extrude' }).click();
  await page.getByLabel('Distance').fill('50');
  await page.getByRole('button', { name: 'OK' }).click();

  // Browser pane should now have Extrusion1
  await expect(page.getByText(/Extrusion1/)).toBeVisible();

  // Viewport should have a positive triangle count
  await expect(page.locator('[data-triangle-count]')).toHaveAttribute('data-triangle-count', /[1-9]\d*/);
});
