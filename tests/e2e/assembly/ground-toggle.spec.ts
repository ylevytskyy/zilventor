import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';

/**
 * T42: E2E — grounded toggle.
 *
 * Strategy:
 *  1. Seed cube, place twice (first auto-grounded by 4a's addComponent).
 *  2. Mate them — solver converges with C1 grounded.
 *  3. Un-ground C1 via store.toggleGrounded('C1') → solver auto-anchors to
 *     components[0] and emits a diagnostic message mentioning "auto-anchored".
 *  4. Assert solverDiagnostics.message matches /auto-anchored/.
 */
test('T42 — grounded toggle causes auto-anchor diagnostic', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await seedAssemblyCubePart(page);

  // Open assembly.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // Place cube twice.
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('p');
    await expect(page.getByRole('dialog', { name: /place component/i })).toBeVisible();
    await page.getByText(/^cube$/).click();
    await page.getByRole('button', { name: /^place$/i }).click();
    await expect(page.getByRole('dialog', { name: /place component/i })).toBeHidden();
    await page.waitForFunction(
      (expected) => {
        const w = window as any;
        return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === expected;
      },
      i + 1,
    );
  }

  const componentIds = await page.evaluate((): string[] => {
    const w = window as any;
    return w.__zilventorStore.getState().activeAssembly.components.map((c: any) => c.id);
  });
  const [c1, c2] = componentIds as [string, string];

  // Verify first component is grounded.
  const c1Grounded = await page.evaluate((id) => {
    const w = window as any;
    return w.__zilventorStore.getState().activeAssembly.groundedComponentIds.includes(id);
  }, c1);
  expect(c1Grounded).toBe(true);

  // Add a mate constraint so the solver has something to work on.
  await page.getByRole('tab', { name: 'Assembly' }).click();
  await page.getByRole('button', { name: 'Mate' }).click();
  await expect(page.getByRole('dialog', { name: /place constraint/i })).toBeVisible();

  await page.getByRole('button', { name: /^pick…$/i }).first().click();
  await page.evaluate(([id]) => {
    (window as any).__zilventorAssemblyPickerSimulate('A', 'face', {
      componentId: id,
      face: { featureId: 'E1', role: 'top', instance: 0 },
    });
  }, [c1]);

  await page.getByRole('button', { name: /^pick…$/i }).nth(1).click();
  await page.evaluate(([id]) => {
    (window as any).__zilventorAssemblyPickerSimulate('B', 'face', {
      componentId: id,
      face: { featureId: 'E1', role: 'bottom', instance: 0 },
    });
  }, [c2]);

  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('dialog', { name: /place constraint/i })).toBeHidden();

  // Wait for initial solve.
  await page.waitForFunction(() => {
    const w = window as any;
    const diag = w.__zilventorAssemblySolverResult?.();
    return (diag?.perConstraint?.size ?? 0) > 0;
  }, undefined, { timeout: 10_000 });

  // Un-ground C1 → solver must auto-anchor.
  await page.evaluate((id) => {
    (window as any).__zilventorStore.getState().toggleGrounded(id);
  }, c1);

  // Wait for re-solve to complete with auto-anchor message.
  await page.waitForFunction(() => {
    const w = window as any;
    const diag = w.__zilventorAssemblySolverResult?.();
    return typeof diag?.message === 'string' && diag.message.includes('auto-anchored');
  }, undefined, { timeout: 10_000 });

  const msg = await page.evaluate(() => {
    const w = window as any;
    return w.__zilventorAssemblySolverResult().message;
  });
  expect(msg).toMatch(/auto-anchored/);
});
