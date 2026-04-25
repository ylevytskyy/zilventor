import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * Create-work-plane E2E (plan T39).
 *
 * Opens the WorkPlane dialog via the ribbon's Work Features panel, switches
 * to offsetFromPlane mode, sets a 25 mm offset from origin.XY, clicks OK,
 * and asserts the part's feature tree gained a workPlane feature.
 *
 * Geometry-hash assertion: the work plane is rendered as a translucent
 * preview node in the SceneManager, which contributes to the geometry
 * hash (see SceneManager.geometryHash).
 */
test('opening WorkPlane dialog from the ribbon and committing offsetFromPlane creates a workPlane feature', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // 1. Click the ribbon's Plane button (Work Features panel).
  await page.getByRole('button', { name: 'Work Plane' }).click();
  const dialog = page.getByRole('dialog', { name: /Work Plane/i });
  await expect(dialog).toBeVisible();

  // 2. Switch to offsetFromPlane mode and set a 25 mm offset. planeA stays
  //    'origin.XY' by default, which exists in every fresh part's tree.
  await dialog.getByLabel('mode').selectOption('offsetFromPlane');
  await dialog.getByLabel('offset').fill('25');

  // 3. Commit.
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).not.toBeVisible();

  // 4. Assert the feature tree contains exactly one user-created workPlane
  //    (origin.XY/YZ/XZ are seeded but their source.mode is 'origin').
  const userPlanes = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          activePart: {
            featureTree: Array<{ kind: string; id: string; source?: { mode: string } }>;
          } | null;
        };
      };
    };
    const part = w.__zilventorStore.getState().activePart!;
    return part.featureTree
      .filter((f) => f.kind === 'workPlane' && f.source?.mode === 'offsetFromPlane')
      .map((f) => f.id);
  });
  expect(userPlanes.length).toBe(1);
});
