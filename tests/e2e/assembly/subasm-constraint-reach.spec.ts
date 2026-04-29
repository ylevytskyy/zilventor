import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';
import { seedSubAssemblyZiasm, makeSubAsmDoc } from '../helpers/seedSubAssembly';

/**
 * T37 (4d Phase 11): a top-level constraint can target a face on a leaf
 * inside a placed sub-assembly. The picker accepts a 2-segment
 * componentPath = [subAsmComponentId, innerLeafId]; the solver bridge
 * walks the path to find the leaf partId, extracts the face, and the LM
 * solves the mate so the residual converges below 1e-2.
 */
test('T37 — top constraint reaches a face on a leaf inside a sub-asm', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await seedAssemblyCubePart(page);

  // Sub-asm with a single inner cube `inner` at the origin.
  const sub = makeSubAsmDoc('sub', [
    { id: 'inner', partPath: 'parts/cube.zipt',
      position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
  ]);
  await seedSubAssemblyZiasm(page, 'sub.ziasm', sub);

  // Open a fresh top assembly. Place the sub.ziasm first, then a top-level
  // cube far above it.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // Place sub.ziasm.
  await page.keyboard.press('p');
  await expect(page.getByRole('dialog', { name: /place component/i })).toBeVisible();
  await page.getByText(/^sub$/).click();
  await page.getByRole('button', { name: /^place$/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 1;
  });

  // Place the top-level cube at z=200 so the mate must move it down.
  await page.keyboard.press('p');
  await expect(page.getByRole('dialog', { name: /place component/i })).toBeVisible();
  await page.getByText(/^cube$/).click();
  await page.getByRole('button', { name: /^place$/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 2;
  });

  // Hydrate sub-asm cache, push the top cube to z=200, and mark the
  // sub-asm placement Flexible so the parent solver can reach the inner
  // leaf as a real unknown. Without flexible, rigid sub-asms hide their
  // leaves from the parent's LM problem.
  await page.evaluate(async () => {
    const w = window as any;
    await w.__zilventorLoadSubAsmTree();
    const components = w.__zilventorStore.getState().activeAssembly.components;
    const subId = components[0].id;
    const cubeId = components[1].id;
    w.__zilventorStore.getState().updateComponent(cubeId, {
      position: { x: 0, y: 0, z: 200 },
    });
    w.__zilventorStore.getState().setComponentFlexible(subId, true);
    // Ground the sub-asm placement AND its inner leaf, so the LM has a
    // stable reference frame and the mate moves the top cube.
    const cur = w.__zilventorStore.getState().activeAssembly;
    const setActive = w.__zilventorStore.getState().setActiveDocument;
    setActive({
      kind: 'assembly',
      document: { ...cur, groundedComponentPaths: [[subId], [subId, 'inner']] },
    });
  });

  // Capture the IDs the picker will receive.
  const ids = await page.evaluate(() => {
    const w = window as any;
    const cs = w.__zilventorStore.getState().activeAssembly.components;
    return { subId: cs[0].id, cubeId: cs[1].id };
  });

  // Open Place Constraint (Mate) and feed both refs via the dev hook.
  await page.getByRole('tab', { name: 'Assembly' }).click();
  await page.getByRole('button', { name: 'Mate' }).click();
  await expect(page.getByRole('dialog', { name: /place constraint/i })).toBeVisible();

  // Pick A: top face of the inner leaf inside the sub-asm.
  await page.getByRole('button', { name: /^pick…$/i }).first().click();
  await page.evaluate(({ subId }) => {
    (window as any).__zilventorAssemblyPickerSimulate('A', 'face', {
      componentPath: [subId, 'inner'],
      face: { featureId: 'E1', role: 'top', instance: 0 },
    });
  }, ids);

  // Pick B: bottom face of the top-level cube.
  await page.getByRole('button', { name: /^pick…$/i }).nth(1).click();
  await page.evaluate(({ cubeId }) => {
    (window as any).__zilventorAssemblyPickerSimulate('B', 'face', {
      componentPath: [cubeId],
      face: { featureId: 'E1', role: 'bottom', instance: 0 },
    });
  }, ids);

  await expect(page.locator('text=(none)')).toHaveCount(0);

  // Commit.
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('dialog', { name: /place constraint/i })).toBeHidden();

  // Wait for the solver and assert residual < 1e-2.
  await page.waitForFunction(() => {
    const w = window as any;
    const d = w.__zilventorAssemblySolverResult?.();
    if (!d) return false;
    return (d.perConstraint?.size ?? 0) > 0;
  }, undefined, { timeout: 10_000 });

  const diag = await page.evaluate(() => {
    const w = window as any;
    const d = w.__zilventorAssemblySolverResult();
    const entries = Array.from((d.perConstraint as Map<string, any>).entries());
    return {
      status: d.status,
      perConstraintSize: entries.length,
      first: entries[0]?.[1] ?? null,
    };
  });

  expect(diag.perConstraintSize).toBe(1);
  expect(diag.first).not.toBeNull();
  expect(diag.first.brokenRef).toBe(false);
  expect(diag.first.residual).toBeLessThan(1e-2);
});
