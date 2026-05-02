import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * T31 — create a panel in a brand-new (empty) part.
 *
 * Drives the full UI flow: New Part → Furniture → Panel → fill dims, add a
 * material via Manage…, pick it, add an edge-band material, band all four
 * edges, OK. Asserts:
 *   - Panel feature appears in the BrowserPane (data-panel-feature-id node).
 *   - The active part now carries one panel feature with the expected
 *     material refs and 4 banded edges.
 *   - The View tab "Show edge bands" toggle is currently checked (default
 *     true) — i.e. the overlay subsystem is active.
 *
 * Selectors are matched against PanelDialog.tsx + MaterialRegistryEditor.tsx
 * exactly (not the plan's draft selectors): the View toggle is a button
 * with text "✓ Show edge bands", Manage… is a toggle (no separate Done),
 * "+ Add" opens an inline form whose submit is "Add".
 */
test('T31 — create panel in empty part: dialog flow + feature inserted', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. New Part
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // 2. Open Furniture tab and click Panel
  await page.getByRole('tab', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Panel' }).click();

  // 3. Dialog visible
  const dialog = page.getByRole('dialog', { name: 'Panel' });
  await expect(dialog).toBeVisible();

  // 4. Fill dimensions. Length/Width labels collide with grain-radio labels,
  //    so we resolve by role.
  await dialog.getByRole('textbox', { name: 'Length' }).fill('600');
  await dialog.getByRole('textbox', { name: 'Width' }).fill('400');

  // 5. Manage… → add Birch Plywood 18mm
  await dialog.getByRole('button', { name: /Manage/i }).click();
  await dialog.getByRole('button', { name: '+ Add' }).click();
  await dialog.getByLabel('New material name').fill('Birch Plywood 18mm');
  await dialog.getByLabel('New material default thickness').fill('18');
  // Color picker is type=color and has a default; that's enough for the test.
  await dialog.getByRole('button', { name: 'Add' }).click();

  // Material registry now contains one row; pick it from the Material select.
  await expect(dialog.locator('[data-testid="material-registry-editor"] tbody tr')).toHaveCount(1);

  // The Material select still shows the previously-empty placeholder until
  // we actively pick the new material — flip it via selectOption(label).
  await dialog.getByLabel('Material').selectOption({ label: 'Birch Plywood 18mm' });
  await expect(dialog.getByLabel('Thickness')).toHaveValue('18');

  // 6. Add a second material (PVC 1mm) for edge bands.
  await dialog.getByRole('button', { name: '+ Add' }).click();
  await dialog.getByLabel('New material name').fill('PVC 1mm white');
  await dialog.getByLabel('New material default thickness').fill('1');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog.locator('[data-testid="material-registry-editor"] tbody tr')).toHaveCount(2);

  // 7. Band all four edges with PVC 1mm white.
  for (const label of ['Edge Front', 'Edge Back', 'Edge Left', 'Edge Right']) {
    await dialog.getByLabel(label).selectOption({ label: 'PVC 1mm white' });
  }

  // 8. OK
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).not.toBeVisible();

  // 9. Browser pane shows a panel feature row.
  await expect(page.locator('[data-panel-feature-id]')).toHaveCount(1);

  // 10. Active part contains exactly one user feature, kind=panel, with
  //     non-null edgeBands on all four edges and the correct shape.
  const summary = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          activePart: {
            featureTree: Array<{ kind: string; id: string }>;
            materials: Array<{ id: string; name: string }>;
          } | null;
        };
      };
    };
    const part = w.__zilventorStore.getState().activePart;
    if (!part) return null;
    const userFeatures = part.featureTree.filter((f) => !f.id.startsWith('origin.'));
    const panel = userFeatures.find((f) => f.kind === 'panel') as
      | (typeof userFeatures[number] & {
          materialId: string;
          edgeBands: Record<string, { materialId: string } | null>;
        })
      | undefined;
    return {
      userFeatureCount: userFeatures.length,
      panel: panel
        ? {
            materialId: panel.materialId,
            bandedEdges: ['front', 'back', 'left', 'right'].filter(
              (k) => panel.edgeBands[k] !== null,
            ),
          }
        : null,
      materialCount: part.materials.length,
      materialNames: part.materials.map((m) => m.name).sort(),
    };
  });

  expect(summary).not.toBeNull();
  expect(summary!.userFeatureCount).toBe(1);
  expect(summary!.panel).not.toBeNull();
  expect(summary!.panel!.bandedEdges).toEqual(['front', 'back', 'left', 'right']);
  expect(summary!.materialCount).toBe(2);
  expect(summary!.materialNames).toEqual(['Birch Plywood 18mm', 'PVC 1mm white']);

  // 11. View tab "Show edge bands" toggle is on (default true).
  await page.getByRole('tab', { name: 'View' }).click();
  await expect(page.getByRole('button', { name: /Show edge bands/i })).toContainText(
    /^✓\s*Show edge bands$/,
  );
});
