import { test, expect } from '@playwright/test';

test('Workflow 3 — edit parameter and undo/redo', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Ready')).toBeVisible({ timeout: 120_000 });

  // Build the same box as Workflow 2.
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();

  await page.getByRole('tab', { name: 'Sketch' }).click();
  await page.getByRole('button', { name: '2D Sketch' }).click();
  await page.getByRole('button', { name: 'Rectangle' }).click();
  await page.getByLabel('x1').fill('0');
  await page.getByLabel('y1').fill('0');
  await page.getByLabel('x2').fill('100');
  await page.getByLabel('y2').fill('200');
  await page.getByRole('button', { name: 'OK' }).click();
  await page.getByRole('button', { name: 'Finish Sketch' }).click();

  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'Extrude' }).click();
  await page.getByLabel('Distance').fill('18');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByText(/Extrusion1/)).toBeVisible();

  // Wait for a positive triangle count (viewport tessellated).
  await expect(page.locator('[data-triangle-count]')).toHaveAttribute('data-triangle-count', /[1-9]\d*/);

  // Double-click the extrusion in the browser pane to select it.
  await page.getByText(/Extrusion1/).dblclick();

  // Properties panel should now show Distance=18; edit to 36 and press Enter.
  await expect(page.getByLabel('Distance')).toHaveValue('18');
  await page.getByLabel('Distance').fill('36');
  await page.getByLabel('Distance').press('Enter');

  // Undo — click the viewport first to take focus off the input, else keydown
  // is gated by the "don't intercept in inputs" guard in App.tsx.
  await page.locator('main#region-viewport').click();
  await page.keyboard.press('Control+z');

  // After undo, re-select the extrusion so the panel refreshes its draft.
  await page.getByText(/Extrusion1/).dblclick();
  await expect(page.getByLabel('Distance')).toHaveValue('18');

  // Redo.
  await page.locator('main#region-viewport').click();
  await page.keyboard.press('Control+y');
  await page.getByText(/Extrusion1/).dblclick();
  await expect(page.getByLabel('Distance')).toHaveValue('36');
});
