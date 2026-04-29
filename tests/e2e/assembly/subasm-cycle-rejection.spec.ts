import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedSubAssemblyZiasm, makeSubAsmDoc } from '../helpers/seedSubAssembly';

/**
 * T38 (4d Phase 11): placing a sub-assembly that would reference the
 * currently active assembly must be rejected by PlaceComponentCommand
 * (wouldCreateCycle returns true). Active doc name defaults to
 * `untitled-assembly`, so its OPFS path is `untitled-assembly.ziasm`.
 *
 * Expectations:
 *  - status message contains "cycle"
 *  - no component is added (top assembly stays at 0 leaves)
 */
test('T38 — placing a cycle-creating sub-asm is rejected', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // Open a fresh top assembly. NewAssemblyCommand sets name = 'untitled-assembly'.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // Seed cyclic.ziasm whose only component references the active doc's
  // OPFS path (untitled-assembly.ziasm) — completes the cycle.
  const cyclic = makeSubAsmDoc('cyclic', [
    { id: 'self', partPath: 'untitled-assembly.ziasm',
      position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
  ]);
  await seedSubAssemblyZiasm(page, 'cyclic.ziasm', cyclic);

  // Try to place cyclic.ziasm via the Place dialog.
  await page.keyboard.press('p');
  await expect(page.getByRole('dialog', { name: /place component/i })).toBeVisible();
  await page.getByText(/^cyclic$/).click();
  await page.getByRole('button', { name: /^place$/i }).click();

  // PlaceComponentCommand sets a status message containing "cycle" when
  // wouldCreateCycle returns true.
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const w = window as any;
      return (w.__zilventorStore.getState().statusMessage ?? '').toLowerCase();
    });
  }, { timeout: 5_000 }).toContain('cycle');

  // No component was added: zero leaves, zero top-level components.
  const componentCount = await page.evaluate(() => {
    const w = window as any;
    return w.__zilventorStore.getState().activeAssembly?.components?.length ?? -1;
  });
  expect(componentCount).toBe(0);

  const leafCount = await page.evaluate(() => {
    const w = window as any;
    return w.__zilventorComponentPathToLeafCount?.([]) ?? -1;
  });
  expect(leafCount).toBe(0);
});
