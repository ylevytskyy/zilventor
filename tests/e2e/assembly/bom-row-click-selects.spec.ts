import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';
import { seedAssemblyCylinderPart } from '../helpers/seedAssemblyCylinderPart';

/**
 * T35 (sub-project 4c, Phase 12): clicking a BOM row selects all matching
 * component instances and applies the orange outline overlay.
 */
test('T35 — BOM row click multi-selects and overlays matching components', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await seedAssemblyCubePart(page);
  await seedAssemblyCylinderPart(page);

  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  await page.evaluate(() => {
    const w = window as any;
    const s = w.__zilventorStore.getState();
    s.addComponent({ id: 'CUBE_A', partPath: 'parts/cube.zipt',     position: { x: 0,   y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
    s.addComponent({ id: 'CUBE_B', partPath: 'parts/cube.zipt',     position: { x: 80,  y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
    s.addComponent({ id: 'CYL',    partPath: 'parts/cylinder.zipt', position: { x: 200, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
  });

  await page.waitForFunction(() => {
    const w = window as any;
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 3;
  });

  // Wait for the assembly-mesh-sync effect to mount the meshes (hash changes off zero).
  await expect.poll(async () => {
    return await page.locator('[data-testid=viewport]').getAttribute('data-geometry-hash');
  }, { timeout: 10_000 }).not.toBe('0');

  await page.getByRole('tab', { name: 'Assembly' }).click();
  await page.locator('[aria-label="BOM panel"]').getByRole('button', { name: /^bom$/i }).click();

  const bomTable = page.locator('[data-testid=bom-table]');
  // Click the QTY cell of the cube row — it does not stopPropagation, so the
  // row's onClick fires. (Item# / Color cells stop propagation by design.)
  const cubeRow = bomTable.locator('tbody tr', { hasText: 'parts/cube.zipt' }).first();
  await cubeRow.locator('td').nth(3).click();

  // selectedComponentPaths contains both cube ids (each a single-segment path).
  const selected = await page.evaluate(() => {
    const w = window as any;
    return w.__zilventorStore.getState().selectedComponentPaths as string[][];
  });
  expect(new Set(selected.map((p) => p[0]))).toEqual(new Set(['CUBE_A', 'CUBE_B']));

  // Outline overlays exist for both cubes and not for the cylinder.
  const overlays = await page.evaluate(() => {
    const w = window as any;
    return {
      a: w.__zilventorComponentSelectedOverlay('CUBE_A'),
      b: w.__zilventorComponentSelectedOverlay('CUBE_B'),
      cyl: w.__zilventorComponentSelectedOverlay('CYL'),
    };
  });
  expect(overlays.a).toBe(true);
  expect(overlays.b).toBe(true);
  expect(overlays.cyl).toBe(false);
});
