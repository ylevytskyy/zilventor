import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';
import { seedSubAssemblyZiasm, makeSubAsmDoc } from '../helpers/seedSubAssembly';

/**
 * T41 (4d Phase 11b): editing a placed sub.ziasm in OPFS and triggering
 * `__zilventorSubAsmInvalidate` cascades through the recursive walkers and
 * the composedPoses bridge. The world pose of the rigid sub-asm leaf
 * follows the new local position from the reloaded sub-asm doc.
 */
test('T41 — sub-asm invalidate cascades to leaf world pose', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await seedAssemblyCubePart(page);

  // Sub-asm with one panel at x=3.
  const subBefore = makeSubAsmDoc('sub', [
    { id: 'panel', partPath: 'parts/cube.zipt',
      position: { x: 3, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
  ]);
  await seedSubAssemblyZiasm(page, 'sub.ziasm', subBefore);

  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  await page.keyboard.press('p');
  await expect(page.getByRole('dialog', { name: /place component/i })).toBeVisible();
  await page.getByText(/^sub$/).click();
  await page.getByRole('button', { name: /^place$/i }).click();
  await expect(page.getByRole('dialog', { name: /place component/i })).toBeHidden();
  await page.waitForFunction(() => {
    const w = window as any;
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 1;
  });

  // Hydrate cache so the leaf is composed.
  await page.evaluate(async () => {
    const w = window as any;
    await w.__zilventorLoadSubAsmTree();
  });

  // Capture initial leaf world pose. Top placement is at (0,0,0) by
  // default, so leaf x ≈ 3 (rigid placement passes the inner local
  // position straight through composedPoses).
  const before = await page.evaluate(() => {
    const w = window as any;
    const s = w.__zilventorStore.getState();
    const sc = s.activeAssembly.components[0].id;
    return w.__zilventorComposedPoseFor([sc, 'panel']);
  });
  expect(before).toBeTruthy();
  expect(before.translation.x).toBeCloseTo(3, 1);

  // Mutate sub.ziasm in OPFS: rewrite with panel.position.x = 7.
  const subAfter = makeSubAsmDoc('sub', [
    { id: 'panel', partPath: 'parts/cube.zipt',
      position: { x: 7, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
  ]);
  await seedSubAssemblyZiasm(page, 'sub.ziasm', subAfter);

  // Invalidate the cache for sub.ziasm — the dev hook re-reads from OPFS
  // and bumps setSolverDirty, which the mesh-sync effect picks up to
  // re-run composedPoses.
  await page.evaluate(async () => {
    const w = window as any;
    await w.__zilventorSubAsmInvalidate('sub.ziasm');
  });

  // Wait for the leaf world pose to reflect x ≈ 7.
  await page.waitForFunction((b: any) => {
    const w = window as any;
    const s = w.__zilventorStore.getState();
    const sc = s.activeAssembly.components[0].id;
    const p = w.__zilventorComposedPoseFor([sc, 'panel']);
    return !!p && Math.abs(p.translation.x - b.translation.x) > 1;
  }, before, { timeout: 10_000 });

  const after = await page.evaluate(() => {
    const w = window as any;
    const s = w.__zilventorStore.getState();
    const sc = s.activeAssembly.components[0].id;
    return w.__zilventorComposedPoseFor([sc, 'panel']);
  });
  expect(after.translation.x).toBeCloseTo(7, 1);
});
