import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';
import { seedSubAssemblyZiasm, makeSubAsmDoc } from '../helpers/seedSubAssembly';

/**
 * T40 (4d Phase 11b): per-leaf colour overrides + placement-level tint
 * propagate through the recursive walkers + scene material.
 *
 *  - Top-level placement of drawer.ziasm carries palette colour `oak`. The
 *    drawer's two interior panels inherit it via resolveColor walking from
 *    placement → leaf → leaf (deepest color wins, but the leaves have no
 *    color of their own here, so the placement tint propagates down).
 *  - Setting a path-keyed override on one leaf to `walnut` splits the BOM
 *    into 2 rows (qty=1 oak, qty=1 walnut) and updates the SceneManager
 *    material on that leaf.
 *  - Clearing the override + retinting the placement to `walnut` then
 *    affects BOTH leaves (because neither has its own override now).
 */
test('T40 — sub-asm color override + placement tint', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await seedAssemblyCubePart(page);

  // drawer.ziasm: two panels, no leaf-level colour. Placement tint will
  // propagate from the top-level placement.
  const drawer = makeSubAsmDoc('drawer', [
    { id: 'panelA', partPath: 'parts/cube.zipt',
      position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    { id: 'panelB', partPath: 'parts/cube.zipt',
      position: { x: 80, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
  ]);
  await seedSubAssemblyZiasm(page, 'drawer.ziasm', drawer);

  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // Register `oak` + `walnut` in the top assembly's palette, enable the
  // showComponentColors render flag (off by default), then place
  // drawer.ziasm and tint the placement `oak`.
  const oakHex = '#d4a574';
  const walnutHex = '#5c3a21';
  await page.evaluate(({ oakHex, walnutHex }) => {
    const w = window as any;
    const s = w.__zilventorStore.getState();
    s.setAssemblyPaletteColor('oak', oakHex);
    s.setAssemblyPaletteColor('walnut', walnutHex);
    s.setShowComponentColors(true);
  }, { oakHex, walnutHex });

  await page.keyboard.press('p');
  await expect(page.getByRole('dialog', { name: /place component/i })).toBeVisible();
  await page.getByText(/^drawer$/).click();
  await page.getByRole('button', { name: /^place$/i }).click();
  await expect(page.getByRole('dialog', { name: /place component/i })).toBeHidden();

  await page.waitForFunction(() => {
    const w = window as any;
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 1;
  });

  // Capture the placement id.
  const drawerId = await page.evaluate(() => {
    const w = window as any;
    return w.__zilventorStore.getState().activeAssembly.components[0].id as string;
  });

  // Hydrate cache + tint placement `oak`.
  await page.evaluate((drawerId) => {
    const w = window as any;
    const s = w.__zilventorStore.getState();
    s.setComponentColor(drawerId, { kind: 'palette', name: 'oak' });
  }, drawerId);
  await page.evaluate(async () => {
    const w = window as any;
    await w.__zilventorLoadSubAsmTree();
  });

  // Both leaves resolve to oak → BOM has 1 row qty=2.
  await page.getByRole('tab', { name: 'Assembly' }).click();
  await page.locator('[aria-label="BOM panel"]').getByRole('button', { name: /^bom$/i }).click();
  const bomTable = page.locator('[data-testid=bom-table]');
  await expect(bomTable).toBeVisible();
  await expect.poll(async () => bomTable.locator('tbody tr').count(), { timeout: 5_000 }).toBe(1);
  await expect(bomTable.locator('tbody tr').first().locator('td').nth(3)).toHaveText('2');

  // Override panelA → walnut. BOM splits: 1 oak, 1 walnut.
  await page.evaluate((drawerId) => {
    const w = window as any;
    w.__zilventorStore.getState().setColorOverride(
      [drawerId, 'panelA'],
      { kind: 'palette', name: 'walnut' },
    );
  }, drawerId);

  await expect.poll(async () => bomTable.locator('tbody tr').count(), { timeout: 5_000 }).toBe(2);

  // Verify the materials in the SceneManager match the override outcome.
  // panelA → walnut, panelB → oak.
  await expect.poll(
    async () => page.evaluate((drawerId) => {
      const w = window as any;
      return w.__zilventorComponentMaterialHexByPath?.([drawerId, 'panelA']) ?? null;
    }, drawerId),
    { timeout: 5_000 },
  ).toBe(walnutHex);
  await expect.poll(
    async () => page.evaluate((drawerId) => {
      const w = window as any;
      return w.__zilventorComponentMaterialHexByPath?.([drawerId, 'panelB']) ?? null;
    }, drawerId),
    { timeout: 5_000 },
  ).toBe(oakHex);

  // Clear the override + retint placement `walnut`. Both leaves should
  // now resolve to walnut (placement tint, no overrides).
  await page.evaluate((drawerId) => {
    const w = window as any;
    const s = w.__zilventorStore.getState();
    s.setColorOverride([drawerId, 'panelA'], null);
    s.setComponentColor(drawerId, { kind: 'palette', name: 'walnut' });
  }, drawerId);

  await expect.poll(async () => bomTable.locator('tbody tr').count(), { timeout: 5_000 }).toBe(1);
  await expect.poll(
    async () => page.evaluate((drawerId) => {
      const w = window as any;
      return w.__zilventorComponentMaterialHexByPath?.([drawerId, 'panelA']) ?? null;
    }, drawerId),
    { timeout: 5_000 },
  ).toBe(walnutHex);
  await expect.poll(
    async () => page.evaluate((drawerId) => {
      const w = window as any;
      return w.__zilventorComponentMaterialHexByPath?.([drawerId, 'panelB']) ?? null;
    }, drawerId),
    { timeout: 5_000 },
  ).toBe(walnutHex);
});
