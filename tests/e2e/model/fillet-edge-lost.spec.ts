import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedKernelPart } from '../helpers/seedKernelPart';

/**
 * T30 — fillet with an invalid edge surfaces a feature-tree warning badge.
 *
 * Seed a cube + fillet whose edge references a non-existent feature. The
 * kernel's FeatureTree executor catches the failure in the fillet adapter,
 * records it in ExecutionResult.featureErrors, and App.tsx mirrors that map
 * into the store. BrowserPane renders a ⚠ button next to the failing feature
 * carrying `data-feature-error=<KernelError.kind>` and an `aria-label`.
 */
test('fillet with invalid edge surfaces feature-tree warning badge', async ({ page }) => {
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
        id: 'F_broken',
        mode: 'constant',
        edges: [
          {
            edgeId: {
              faceA: { featureId: 'NONEXISTENT', role: 'top' },
              faceB: { featureId: 'NONEXISTENT', role: 'side' },
            },
            selectionMode: 'edge',
            radius: { kind: 'param', paramName: 'r_fillet' },
          },
        ],
      },
    ],
  });

  // BrowserPane renders a warning badge for the failing fillet.
  const badge = page.locator('[aria-label="Feature F_broken has errors"]');
  await expect(badge).toBeVisible({ timeout: 10_000 });

  // data-feature-error carries the KernelError kind.
  await expect(badge).toHaveAttribute('data-feature-error', 'edgeNotFound');
});
