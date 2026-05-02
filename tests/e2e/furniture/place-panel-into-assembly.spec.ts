import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * T32 — place a panel into an assembly via the Furniture tab.
 *
 * In assembly mode, FurnitureTab → Panel triggers
 * CreateAndPlacePanelCommand on submit, which:
 *   1. Builds a fresh PartDocument with the panel as the first user feature.
 *   2. Reconciles materials against the active assembly's registry.
 *   3. Persists the part as `parts/Panel-<id>.zipt` in OPFS.
 *   4. Adds a ComponentInstance to the assembly.
 *
 * Asserts:
 *   - One component placed in the assembly.
 *   - The placed component references the persisted part path.
 *   - The assembly material registry contains the new material (reconciled in).
 *   - The persisted .zipt is readable from OPFS.
 *
 * Selectors are matched against PanelDialog.tsx + MaterialRegistryEditor.tsx
 * directly. We bypass the FSA save-picker entirely — the assembly is kept
 * in-memory; it's the OPFS-backed part archive we verify.
 */
test('T32 — place panel into assembly with material reconciliation', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. New Assembly
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
    };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // 2. Furniture → Panel
  await page.getByRole('tab', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Panel' }).click();

  const dialog = page.getByRole('dialog', { name: 'Panel' });
  await expect(dialog).toBeVisible();

  // 3. Fill dimensions.
  await dialog.getByRole('textbox', { name: 'Length' }).fill('800');
  await dialog.getByRole('textbox', { name: 'Width' }).fill('500');

  // 4. Open Manage… and add a material.
  await dialog.getByRole('button', { name: /Manage/i }).click();
  await dialog.getByRole('button', { name: '+ Add' }).click();
  await dialog.getByLabel('New material name').fill('Birch Plywood 18mm');
  await dialog.getByLabel('New material default thickness').fill('18');
  await dialog.getByRole('button', { name: 'Add' }).click();

  // 5. Pick the material.
  await dialog.getByLabel('Material').selectOption({ label: 'Birch Plywood 18mm' });
  await expect(dialog.getByLabel('Thickness')).toHaveValue('18');

  // 6. OK — CreateAndPlacePanelCommand fires.
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).not.toBeVisible();

  // 7. Wait until the new component is in the assembly.
  await expect
    .poll(async () => {
      return await page.evaluate(() => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): {
              activeAssembly: {
                components: Array<{ id: string; partPath: string }>;
                materials: Array<{ id: string; name: string }>;
              } | null;
            };
          };
        };
        return w.__zilventorStore.getState().activeAssembly?.components.length ?? 0;
      });
    }, { timeout: 10_000 })
    .toBe(1);

  const summary = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          activeAssembly: {
            components: Array<{ id: string; partPath: string }>;
            materials: Array<{ id: string; name: string }>;
          } | null;
        };
      };
    };
    const a = w.__zilventorStore.getState().activeAssembly;
    if (!a) return null;
    return {
      componentCount: a.components.length,
      partPath: a.components[0]?.partPath ?? null,
      materialNames: a.materials.map((m) => m.name).sort(),
    };
  });

  expect(summary).not.toBeNull();
  expect(summary!.componentCount).toBe(1);
  expect(summary!.partPath).toMatch(/^parts\/Panel-pf-\d+\.zipt$/);
  expect(summary!.materialNames).toEqual(['Birch Plywood 18mm']);

  // 8. The persisted part archive exists in OPFS.
  const opfsHas = await page.evaluate(async (partPath: string) => {
    const root = await navigator.storage.getDirectory();
    const partsDir = await root.getDirectoryHandle('parts');
    const fileName = partPath.split('/').pop()!;
    try {
      await partsDir.getFileHandle(fileName);
      return true;
    } catch {
      return false;
    }
  }, summary!.partPath!);
  expect(opfsHas).toBe(true);
});
