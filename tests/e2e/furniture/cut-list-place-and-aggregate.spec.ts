import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyPanelPart } from '../helpers/seedAssemblyPanelPart';

/**
 * T24 — cut list aggregates 3 panels (2 identical, 1 distinct) into 2 rows.
 *
 * Seeds two distinct panel parts (side 600x400, top 800x400) in OPFS, places
 * 2 instances of "side" and 1 instance of "top" into an assembly, then opens
 * the Cut List tab and asserts:
 *   - Exactly 2 data rows ([data-cutlist-row])
 *   - Row 0 QTY = 2 (the two identical 600x400 panels)
 *   - Row 1 QTY = 1 (the single 800x400 panel)
 */
test('T24 — cut list aggregates 3 panels (2 identical + 1 distinct) into 2 rows', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. New Assembly.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
    };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // 2. Add the shared material to the assembly registry so the cut list can
  //    resolve material names.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): { addMaterial(m: unknown): void };
      };
    };
    w.__zilventorStore.getState().addMaterial({
      id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896',
    });
  });

  // 3. Seed two distinct panel parts to OPFS.
  await seedAssemblyPanelPart(page, {
    partPath: 'parts/t24-side.zipt',
    partName: 't24-side',
    length: 600, width: 400, thickness: 18,
    materialId: 'm-birch',
    grain: 'length',
    materials: [{ id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' }],
  });
  await seedAssemblyPanelPart(page, {
    partPath: 'parts/t24-top.zipt',
    partName: 't24-top',
    length: 800, width: 400, thickness: 18,
    materialId: 'm-birch',
    grain: 'length',
    materials: [{ id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' }],
  });

  // 4. Place 2× side + 1× top via direct store mutation.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): { addComponent(c: unknown): void };
      };
    };
    const add = w.__zilventorStore.getState().addComponent;
    add({ id: 'C0', partPath: 'parts/t24-side.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
    add({ id: 'C1', partPath: 'parts/t24-side.zipt', position: { x: 700, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
    add({ id: 'C2', partPath: 'parts/t24-top.zipt', position: { x: 0, y: 700, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
  });

  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeAssembly?: { components: unknown[] } | null } };
    };
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 3;
  });

  // 5. Populate the panel spec cache from OPFS (required for cut list rows).
  await page.evaluate(async () => {
    const w = window as unknown as { __zilventorLoadCutListSpecs?: () => Promise<void> };
    await w.__zilventorLoadCutListSpecs?.();
  });

  // 6. Open the Cut List tab.
  await page.getByRole('button', { name: 'Cut List tab' }).click();

  // 7. Assert: material name visible, 2 rows, correct QTY values.
  await expect(page.getByText('Birch 18mm').first()).toBeVisible({ timeout: 10_000 });

  const rows = page.locator('[data-cutlist-row]');
  await expect(rows).toHaveCount(2);

  // Row 0: the two identical side panels (600×400) → QTY 2.
  await expect(rows.nth(0).locator('td').nth(1)).toHaveText('2');
  // Row 1: the single top panel (800×400) → QTY 1.
  await expect(rows.nth(1).locator('td').nth(1)).toHaveText('1');
});
