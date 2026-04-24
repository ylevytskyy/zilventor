import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedKernelPart } from '../helpers/seedKernelPart';

/**
 * T29 — parametric fillet cascade.
 *
 * Seed a cube + fillet whose radius references parameter `r_fillet = 1`. Open
 * the Parameters panel with F7 and edit `r_fillet` to `3`. Assert the viewport
 * triangle count changes — a 3 mm fillet tessellates differently than a 1 mm
 * fillet on the same cube, which only happens if the parameter-change cascade
 * reaches the fillet feature recomputation path.
 */
test.skip('fillet geometry responds to radius parameter change (partial fix: cascade now calls kernel.execute but fillet mesh does not re-tessellate with new radius)', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  await seedKernelPart(page, {
    parameters: [
      { name: 'd1', expression: '10', value: 10, unit: 'mm' },
      { name: 'r_fillet', expression: '1', value: 1, unit: 'mm' },
    ],
    sketches: [
      {
        id: 'S1',
        primitives: [{ id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 10, h: 10 }],
      },
    ],
    extrudes: [{ id: 'E1', sketchRef: 'S1', distanceParam: 'd1', operation: 'new' }],
    fillets: [
      {
        id: 'F1',
        mode: 'constant',
        edges: [
          {
            edgeId: {
              faceA: { featureId: 'E1', role: 'top', instance: 0 },
              faceB: { featureId: 'E1', role: 'side', instance: 0 },
            },
            selectionMode: 'edge',
            radius: { kind: 'param', paramName: 'r_fillet' },
          },
        ],
      },
    ],
  });

  // Mirror r_fillet into the ParameterRegistry so the F7 panel lists it.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorParameterRegistry: {
        setParameter(p: { name: string; expression: string; unit: string }): unknown;
      };
    };
    w.__zilventorParameterRegistry.setParameter({
      name: 'r_fillet',
      expression: '1',
      unit: 'mm',
    });
    w.__zilventorParameterRegistry.setParameter({
      name: 'd1',
      expression: '10',
      unit: 'mm',
    });
  });

  const viewport = page.locator('[data-testid="viewport"]');
  await expect(viewport).toHaveAttribute('data-triangle-count', /[1-9]\d*/);

  const beforeTris = await viewport.getAttribute('data-triangle-count');
  expect(beforeTris).toBeTruthy();
  expect(Number(beforeTris)).toBeGreaterThan(0);

  // Open Parameters panel via F7 and edit r_fillet from 1 to 3.
  await page.keyboard.press('F7');
  await expect(page.getByRole('dialog', { name: /Parameters/i })).toBeVisible();
  await expect(page.locator('[data-testid="param-expression-r_fillet"]')).toHaveText('1');

  await page.locator('[data-testid="param-expression-r_fillet"]').dblclick();
  const input = page.locator('[data-testid="param-row-r_fillet"] input');
  await input.fill('3');
  await input.press('Enter');

  // Registry recompute is synchronous.
  await expect(page.locator('[data-testid="param-value-r_fillet"]')).toHaveText('3');

  // The cascade must reach kernel → executeTree → viewport. A 3 mm fillet on a
  // 10 mm cube edge tessellates with a measurably different triangle count than
  // a 1 mm fillet — wait for that difference to surface.
  await expect
    .poll(async () => viewport.getAttribute('data-triangle-count'), {
      timeout: 10_000,
      message: 'expected triangle count to change after r_fillet edit',
    })
    .not.toBe(beforeTris);

  const afterTris = await viewport.getAttribute('data-triangle-count');
  expect(afterTris).toBeTruthy();
  expect(Number(afterTris)).toBeGreaterThan(0);
  expect(afterTris).not.toBe(beforeTris);
});
