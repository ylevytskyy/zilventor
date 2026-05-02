import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * T33 — material registry CRUD with reference guard.
 *
 * Flow: New Part → seed a referencing PanelFeature directly into the active
 * part's tree (so DeleteMaterialCommand sees it). Then open the Panel dialog
 * (programmatically — bypasses PART_NOT_EMPTY) → Manage… → add 3 materials
 * + edit one's thickness → attempt to delete the panel-referenced one →
 * MATERIAL_IN_USE inline → cancel → delete an unreferenced one → succeeds.
 *
 * The dialog is opened by writing to `useAppStore.panelDialog` directly:
 * OpenPanelDialogCommand would throw PART_NOT_EMPTY now that the panel is
 * in the tree. The MaterialRegistryEditor reads/writes through the same
 * Add/Edit/DeleteMaterialCommand commands the production UI uses.
 */
test('T33 — material registry CRUD with reference guard', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. New Part.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // 2. Seed a panel feature referencing material id "mat-birch" directly
  //    into the active part's featureTree. The actual material doesn't
  //    have to exist in the registry yet — DeleteMaterialCommand only walks
  //    the panels and looks at their materialId / edgeBands materialId.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          activePart: {
            featureTree: unknown[];
            id: string;
          } | null;
          setActivePart(p: unknown): void;
        };
      };
    };
    const s = w.__zilventorStore.getState();
    const part = s.activePart;
    if (!part) throw new Error('no active part');
    const panel = {
      kind: 'panel',
      id: 'pf-test',
      length: { kind: 'literal', value: 600 },
      width: { kind: 'literal', value: 400 },
      thickness: { kind: 'literal', value: 18 },
      thicknessFromMaterial: false,
      materialId: 'mat-birch',
      grain: 'length',
      edgeBands: { front: null, back: null, left: null, right: null },
    };
    s.setActivePart({ ...part, featureTree: [...part.featureTree, panel] });
  });

  // 3. Open the dialog directly via store (skips OpenPanelDialogCommand's
  //    PART_NOT_EMPTY check).
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { setPanelDialog(s: unknown): void } };
    };
    w.__zilventorStore.getState().setPanelDialog({
      mode: 'part',
      onSubmit: () => {},
      onCancel: () => w.__zilventorStore.getState().setPanelDialog(null),
    });
  });

  const dialog = page.getByRole('dialog', { name: 'Panel' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /Manage/i }).click();

  const editor = dialog.locator('[data-testid="material-registry-editor"]');
  await expect(editor).toBeVisible();

  // 4. Add three materials: panel-referenced (id = 'mat-birch') + two extras.
  //    AddMaterialCommand auto-generates a fresh id; that means even the
  //    "Birch Plywood 18mm" we add here gets a *different* id from the
  //    panel's reference. To set up the in-use guard, we add the panel-
  //    referenced material under its original id by injecting through the
  //    store's `addMaterial` action directly first.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { addMaterial(m: unknown): void } };
    };
    w.__zilventorStore.getState().addMaterial({
      id: 'mat-birch',
      name: 'Birch Plywood 18mm',
      defaultThickness: 18,
      color: '#d8c896',
    });
  });
  await expect(editor.locator('tbody tr')).toHaveCount(1);

  // Now add 2 extras through the dialog's own +Add path.
  for (const m of [
    { name: 'MDF 16mm', t: '16' },
    { name: 'PVC 1mm white', t: '1' },
  ]) {
    await editor.getByRole('button', { name: '+ Add' }).click();
    await editor.getByLabel('New material name').fill(m.name);
    await editor.getByLabel('New material default thickness').fill(m.t);
    await editor.getByRole('button', { name: 'Add' }).click();
  }
  await expect(editor.locator('tbody tr')).toHaveCount(3);

  // 5. Edit MDF 16mm's default thickness 16 → 17.
  const mdfRow = editor.locator('tbody tr').filter({ hasText: 'MDF 16mm' });
  await mdfRow.hover();
  await mdfRow.getByRole('button', { name: /Edit MDF 16mm/i }).click();
  await editor.getByLabel('Edit default thickness').fill('17');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(mdfRow).toContainText('17');

  // 6. Attempt to delete Birch Plywood 18mm — referenced by panel pf-test.
  //    DeleteMaterialCommand throws MATERIAL_IN_USE; row reports it inline.
  const birchRow = editor.locator('tbody tr').filter({ hasText: 'Birch Plywood 18mm' });
  await birchRow.hover();
  await birchRow.getByRole('button', { name: /Delete Birch Plywood 18mm/i }).click();
  await editor.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(editor.getByRole('alert')).toContainText(/MATERIAL_IN_USE/i);

  // Cancel the delete.
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await expect(birchRow).toBeVisible();

  // 7. Delete the unreferenced PVC 1mm white — should succeed.
  const pvcRow = editor.locator('tbody tr').filter({ hasText: 'PVC 1mm white' });
  await pvcRow.hover();
  await pvcRow.getByRole('button', { name: /Delete PVC 1mm white/i }).click();
  await editor.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(editor.locator('tbody tr')).toHaveCount(2);

  // 8. Surviving registry shape on the active part.
  const remaining = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): { activePart: { materials: Array<{ name: string; defaultThickness: number }> } | null };
      };
    };
    const part = w.__zilventorStore.getState().activePart;
    return part?.materials.map((m) => ({ name: m.name, t: m.defaultThickness })).sort((a, b) => a.name.localeCompare(b.name)) ?? [];
  });
  expect(remaining).toEqual([
    { name: 'Birch Plywood 18mm', t: 18 },
    { name: 'MDF 16mm', t: 17 },
  ]);
});
