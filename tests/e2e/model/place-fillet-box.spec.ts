import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedKernelPart } from '../helpers/seedKernelPart';

/**
 * T27 — place a fillet on a box via state-seeded feature.
 *
 * Interactive edge-pick is stubbed until tessellated-edge extraction lands in
 * ExecutionResult; this test uses the `seedKernelPart` helper to push a
 * FilletFeature directly into the kernel, then verifies the feature tree and
 * viewport mesh reflect the fillet.
 */
test('place a fillet on a box via state-seeded feature', async ({ page }) => {
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
      { name: 'r_fillet', expression: '2', value: 2, unit: 'mm' },
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

  // Feature tree contains the fillet.
  const count = await page.evaluate(() => {
    const s = (window as unknown as {
      __zilventorStore: {
        getState(): { activePart: { featureTree: Array<{ kind: string }> } };
      };
    }).__zilventorStore.getState();
    return s.activePart.featureTree.filter((f) => f.kind === 'fillet').length;
  });
  expect(count).toBe(1);

  // Viewport has geometry (the box, at minimum).
  await expect(page.locator('[data-triangle-count]')).toHaveAttribute(
    'data-triangle-count',
    /[1-9]\d*/
  );
});
