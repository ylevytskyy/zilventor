import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedKernelPart } from '../helpers/seedKernelPart';

/**
 * T18 — parametric revolve cascade.
 *
 * Seed a part with a revolve using `angleParam: 'theta0'` and `theta0 = 180`.
 * Open the Parameters panel (F7), edit `theta0` to `90`, and verify the
 * viewport geometry regenerates (triangle count changes as the sweep angle
 * halves — a 180° revolve and a 90° revolve of the same profile produce
 * meshes with different triangle counts).
 *
 * This proves the full main-thread cascade:
 *   ParametersPanel → registry.setParameter → registry.subscribe →
 *   store.setParameterInStore → kernel.setParameter → kernel.execute →
 *   viewport.setMesh
 */
test('parameter change cascades to revolve geometry', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Create a part via the UI so the kernel's internal parts map has it.
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // 2. Seed sketch + theta0 parameter + revolve feature by pushing through
  //    the kernel directly (same pragmatic state-seeding pattern as T16/T17),
  //    then mirror theta0 into the ParameterRegistry so the F7 panel lists it.
  //    The AddRevolveFeatureCommand would normally do both; we replicate that
  //    split here without going through the dialog.
  //
  //    Rectangle profile offset from origin + vertical axis along X=0 so the
  //    revolve sweeps around the Y axis.
  await seedKernelPart(page, {
    parameters: [{ name: 'theta0', expression: '180', value: 180, unit: 'deg' }],
    sketches: [
      {
        id: 'S_rev',
        primitives: [
          { id: 'P_rect', kind: 'rectangle', x: 10, y: 0, w: 30, h: 20 },
          { id: 'P_axis', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 20 },
        ],
      },
    ],
    revolves: [
      {
        id: 'R1',
        sketchRef: 'S_rev',
        axisPrimitiveId: 'P_axis',
        angleParam: 'theta0',
        operation: 'new',
      },
    ],
  });

  // Register theta0 in the ParameterRegistry so the F7 panel lists it.
  // The kernel's parameters map was already populated by seedKernelPart above.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorParameterRegistry: {
        setParameter(p: { name: string; expression: string; unit: string }): unknown;
      };
    };
    w.__zilventorParameterRegistry.setParameter({
      name: 'theta0', expression: '180', unit: 'deg',
    });
  });

  // The activePart change triggers the executeTree useEffect, which pushes
  // mesh to the viewport. Wait for the triangle count to become positive
  // (i.e. the 180° sweep has been tessellated).
  const viewport = page.locator('[data-testid="viewport"]');
  await expect(viewport).toHaveAttribute('data-triangle-count', /[1-9]\d*/);

  // Capture the triangle count BEFORE the parameter edit.
  const beforeTris = await viewport.getAttribute('data-triangle-count');
  expect(beforeTris).toBeTruthy();
  expect(Number(beforeTris)).toBeGreaterThan(0);

  // 3. Open the Parameters panel via F7 shortcut.
  await page.keyboard.press('F7');
  const panel = page.getByRole('dialog', { name: /Parameters/i });
  await expect(panel).toBeVisible();

  // theta0 row should be present with expression "180" and value "180".
  await expect(page.locator('[data-testid="param-expression-theta0"]')).toHaveText('180');
  await expect(page.locator('[data-testid="param-value-theta0"]')).toHaveText('180');

  // 4. Edit theta0's expression from "180" to "90".
  await page.locator('[data-testid="param-expression-theta0"]').dblclick();
  const input = page.locator('[data-testid="param-row-theta0"] input');
  await input.fill('90');
  await input.press('Enter');

  // Panel value updates immediately (synchronous registry recompute).
  await expect(page.locator('[data-testid="param-value-theta0"]')).toHaveText('90');

  // 5. The cascade must reach the kernel → recompute → viewport. Wait for the
  //    triangle count to differ from the 180° baseline.
  await expect.poll(
    async () => viewport.getAttribute('data-triangle-count'),
    { timeout: 10_000, message: 'expected triangle count to change after theta0 edit' }
  ).not.toBe(beforeTris);

  const afterTris = await viewport.getAttribute('data-triangle-count');
  expect(afterTris).toBeTruthy();
  expect(Number(afterTris)).toBeGreaterThan(0);
  expect(afterTris).not.toBe(beforeTris);
});
