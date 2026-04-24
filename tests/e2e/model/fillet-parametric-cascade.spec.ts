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
test('fillet geometry responds to radius parameter change', async ({ page }) => {
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
      { name: 'r_fillet', expression: '0.5', value: 0.5, unit: 'mm' },
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
      expression: '0.5',
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

  // Wait for the initial execute to settle so the geometry hash reflects
  // the r_fillet=0.5 body, not a pre-fillet cube.
  await expect(viewport).toHaveAttribute('data-geometry-hash', /^[0-9a-f]+$/);
  const beforeHash = await viewport.getAttribute('data-geometry-hash');
  expect(beforeHash).toBeTruthy();

  // Open Parameters panel via F7 and edit r_fillet from 1 to 3.
  await page.keyboard.press('F7');
  await expect(page.getByRole('dialog', { name: /Parameters/i })).toBeVisible();
  await expect(page.locator('[data-testid="param-expression-r_fillet"]')).toHaveText('0.5');

  await page.locator('[data-testid="param-expression-r_fillet"]').dblclick();
  const input = page.locator('[data-testid="param-row-r_fillet"] input');
  await input.fill('4.5');
  await input.press('Enter');

  // Registry recompute is synchronous.
  await expect(page.locator('[data-testid="param-value-r_fillet"]')).toHaveText('4.5');

  // The cascade must reach kernel → executeTree → viewport. A 4.5 mm fillet
  // and a 0.5 mm fillet tessellate to different vertex positions; the
  // viewport's geometry-hash attribute (FNV-1a over positions) detects that
  // change even when the triangle count happens to coincide — which it does
  // at linearDeflection=0.1 for this particular cube+edge combination.
  await expect
    .poll(async () => viewport.getAttribute('data-geometry-hash'), {
      timeout: 10_000,
      message: 'expected geometry hash to change after r_fillet edit',
    })
    .not.toBe(beforeHash);

  const afterHash = await viewport.getAttribute('data-geometry-hash');
  expect(afterHash).toBeTruthy();
  expect(afterHash).not.toBe(beforeHash);
});
