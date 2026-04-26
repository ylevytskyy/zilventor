import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';

/**
 * T41: E2E — suppress / unsuppress constraint.
 *
 * Strategy:
 *  1. Seed cube, place twice, mate them.
 *  2. Assert solver converges (residual < 1e-2).
 *  3. Get the constraint ID from the store.
 *  4. Call store.toggleConstraintSuppression(id) → re-solve.
 *  5. Assert constraint is suppressed: perConstraint entry has residual=0.
 *  6. Toggle back → assert residual < 1e-2 again (unsuppressed).
 */
test('T41 — suppress / unsuppress constraint', async ({ page }) => {
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

  // Add mate constraint (face-to-face).
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

  // Wait for solver — initial solve must converge.
  await page.waitForFunction(() => {
    const w = window as any;
    const diag = w.__zilventorAssemblySolverResult?.();
    if (!diag) return false;
    return (diag.perConstraint?.size ?? 0) > 0;
  }, undefined, { timeout: 10_000 });

  const initialResidual = await page.evaluate(() => {
    const w = window as any;
    const d = w.__zilventorAssemblySolverResult();
    const first = Array.from((d.perConstraint as Map<string, any>).values())[0];
    return first?.residual ?? null;
  });
  expect(initialResidual).not.toBeNull();
  expect(initialResidual).toBeLessThan(1e-2);

  // Get the constraint ID.
  const constraintId = await page.evaluate(() => {
    const w = window as any;
    const d = w.__zilventorAssemblySolverResult();
    return Array.from((d.perConstraint as Map<string, any>).keys())[0] ?? null;
  });
  expect(constraintId).not.toBeNull();

  // Suppress the constraint via store.
  await page.evaluate((id) => {
    (window as any).__zilventorStore.getState().toggleConstraintSuppression(id);
  }, constraintId!);

  // Wait for re-solve after suppression.
  await page.waitForFunction((id) => {
    const w = window as any;
    const diag = w.__zilventorAssemblySolverResult?.();
    if (!diag) return false;
    const entry = (diag.perConstraint as Map<string, any>).get(id);
    // Suppressed constraints get residual=0 in the solver output.
    return entry !== undefined && entry.residual === 0;
  }, constraintId!, { timeout: 10_000 });

  const suppressedEntry = await page.evaluate((id) => {
    const w = window as any;
    const d = w.__zilventorAssemblySolverResult();
    return (d.perConstraint as Map<string, any>).get(id) ?? null;
  }, constraintId!);
  expect(suppressedEntry).not.toBeNull();
  expect(suppressedEntry!.residual).toBe(0);
  expect(suppressedEntry!.brokenRef).toBe(false);

  // Unsuppress — residual should return to < 1e-2.
  await page.evaluate((id) => {
    (window as any).__zilventorStore.getState().toggleConstraintSuppression(id);
  }, constraintId!);

  await page.waitForFunction((id) => {
    const w = window as any;
    const diag = w.__zilventorAssemblySolverResult?.();
    if (!diag) return false;
    const entry = (diag.perConstraint as Map<string, any>).get(id);
    return entry !== undefined && entry.residual < 1e-2;
  }, constraintId!, { timeout: 10_000 });

  const unsuppressedEntry = await page.evaluate((id) => {
    const w = window as any;
    const d = w.__zilventorAssemblySolverResult();
    return (d.perConstraint as Map<string, any>).get(id) ?? null;
  }, constraintId!);
  expect(unsuppressedEntry!.residual).toBeLessThan(1e-2);
});
