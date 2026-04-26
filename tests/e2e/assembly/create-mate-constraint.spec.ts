import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';

/**
 * T38: E2E — create a mate face↔face constraint between two cube instances.
 *
 * Strategy:
 *  1. Seed a 50 mm cube part to OPFS.
 *  2. Open a new assembly and place the cube twice.
 *  3. Open the Place Constraint dialog (Mate mode) via the AssemblyTab button.
 *  4. Click "Pick A", then call __zilventorAssemblyPickerSimulate to feed
 *     the top face of component A without real viewport interaction.
 *  5. Click "Pick B", feed the bottom face of component B.
 *  6. Click OK — AddAssemblyConstraintCommand fires, solver runs.
 *  7. Assert: one constraint in perConstraint, brokenRef=false, residual<1e-2.
 *
 * Face names for a forward (+Z) extrude with id='E1':
 *   top    = { featureId: 'E1', role: 'top' }    (+Z face, at Z=50)
 *   bottom = { featureId: 'E1', role: 'bottom' } (−Z face, at Z=0)
 */
test('create mate face↔face constraint between two cubes', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await seedAssemblyCubePart(page);

  // Open a new assembly.
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

  // Confirm two components are present and grab their IDs.
  const componentIds = await page.evaluate((): string[] => {
    const w = window as any;
    return w.__zilventorStore.getState().activeAssembly.components.map((c: any) => c.id);
  });
  expect(componentIds).toHaveLength(2);
  const [c1, c2] = componentIds as [string, string];

  // Switch to Assembly tab and open Place Constraint dialog in Mate mode.
  await page.getByRole('tab', { name: 'Assembly' }).click();
  await page.getByRole('button', { name: 'Mate' }).click();
  await expect(page.getByRole('dialog', { name: /place constraint/i })).toBeVisible();

  // Pick face A: top face of component 1.
  // Clicking "Pick A" calls assemblyPickerRef.activate('face', 'A', cb).
  // Then the simulate hook calls handleFaceHit immediately — cb fires and
  // setPickedRefA is called — all in the same evaluate().
  await page.getByRole('button', { name: /^pick…$/i }).first().click();
  await page.evaluate(([c1Id]) => {
    (window as any).__zilventorAssemblyPickerSimulate('A', 'face', {
      componentId: c1Id,
      face: { featureId: 'E1', role: 'top', instance: 0 },
    });
  }, [c1]);

  // Pick face B: bottom face of component 2.
  await page.getByRole('button', { name: /^pick…$/i }).nth(1).click();
  await page.evaluate(([c2Id]) => {
    (window as any).__zilventorAssemblyPickerSimulate('B', 'face', {
      componentId: c2Id,
      face: { featureId: 'E1', role: 'bottom', instance: 0 },
    });
  }, [c2]);

  // Both picks should now display labels (not "(none)").
  await expect(page.locator('text=(none)')).toHaveCount(0);

  // Commit the constraint.
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('dialog', { name: /place constraint/i })).toBeHidden();

  // Wait for the solver to run (50 ms debounce + async ref resolution).
  await page.waitForFunction(() => {
    const w = window as any;
    const diag = w.__zilventorAssemblySolverResult?.();
    if (!diag) return false;
    // The initial store state has perConstraint as an empty Map; after the solve
    // it should have at least one entry.
    return (diag.perConstraint?.size ?? 0) > 0;
  }, undefined, { timeout: 10_000 });

  // Assert: one constraint, no broken-ref, solver converged.
  const diag = await page.evaluate(() => {
    const w = window as any;
    const d = w.__zilventorAssemblySolverResult();
    const entries = Array.from((d.perConstraint as Map<string, any>).entries());
    return {
      status: d.status,
      dofCount: d.dofCount,
      constraintCount: entries.length,
      firstConstraint: entries.length > 0 ? entries[0]![1] : null,
    };
  });

  expect(diag.constraintCount).toBe(1);
  expect(diag.firstConstraint).not.toBeNull();
  expect(diag.firstConstraint!.brokenRef).toBe(false);
  expect(diag.firstConstraint!.residual).toBeLessThan(1e-2);
});
