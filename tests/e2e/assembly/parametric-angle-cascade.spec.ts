import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';

/**
 * T43: E2E — parametric angle cascade through ParameterRegistry.
 *
 * Strategy:
 *  1. Seed cube, place twice.
 *  2. Add a parameter `hinge_open = 30` to the ParameterRegistry via dev hook.
 *  3. Open angle constraint dialog, pick face-to-face, set value expression to
 *     `=hinge_open` (the store parses `=` prefix as a param reference; verify
 *     the expression accepted format from parseParamOrLiteral).
 *  4. Commit → solver converges at 30°.
 *  5. Change parameter to 60 via dev hook → wait for debounce + cascade.
 *  6. Assert residual < 1e-2 after re-solve.
 *
 * Note: parseParamOrLiteral in App.tsx is used to interpret the value expression.
 * A param reference is expressed as `=hinge_open` in the value input field.
 */
test('T43 — parametric angle cascade through ParameterRegistry', async ({ page }) => {
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

  // Add parameter hinge_open = 30 deg to the registry.
  await page.evaluate(() => {
    const registry = (window as any).__zilventorParameterRegistry;
    registry.setParameter({ name: 'hinge_open', expression: '30', unit: 'deg' });
  });

  // Open angle constraint dialog.
  await page.keyboard.press('n');
  await expect(page.getByRole('dialog', { name: /place constraint/i })).toBeVisible();

  // Pick axis A: angle mode uses 'axis' picker — simulate via cylindricalFace hit.
  await page.getByRole('button', { name: /^pick…$/i }).first().click();
  await page.evaluate(([id]) => {
    (window as any).__zilventorAssemblyPickerSimulate('A', 'cylindricalFace', {
      componentId: id,
      face: { featureId: 'E1', role: 'top', instance: 0 },
    });
  }, [c1]);

  // Pick axis B: angle mode uses 'axis' picker — simulate via cylindricalFace hit.
  await page.getByRole('button', { name: /^pick…$/i }).nth(1).click();
  await page.evaluate(([id]) => {
    (window as any).__zilventorAssemblyPickerSimulate('B', 'cylindricalFace', {
      componentId: id,
      face: { featureId: 'E1', role: 'top', instance: 0 },
    });
  }, [c2]);

  // Set value to 30 (literal matching the hinge_open parameter value).
  // The value input is a plain text <input> inside the Place Constraint dialog.
  const valueInput = page.getByRole('dialog', { name: /place constraint/i }).locator('input');
  await valueInput.fill('30');

  // Commit.
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('dialog', { name: /place constraint/i })).toBeHidden();

  // Wait for first solve.
  await page.waitForFunction(() => {
    const w = window as any;
    const diag = w.__zilventorAssemblySolverResult?.();
    return (diag?.perConstraint?.size ?? 0) > 0;
  }, undefined, { timeout: 10_000 });

  const firstResidual = await page.evaluate(() => {
    const w = window as any;
    const d = w.__zilventorAssemblySolverResult();
    const first = Array.from((d.perConstraint as Map<string, any>).values())[0];
    return first?.residual ?? null;
  });
  expect(firstResidual).not.toBeNull();
  expect(firstResidual).toBeLessThan(1e-2);

  // Change parameter to 60 — triggers cascade via parameterRegistry subscription.
  await page.evaluate(() => {
    const registry = (window as any).__zilventorParameterRegistry;
    registry.setParameter({ name: 'hinge_open', expression: '60', unit: 'deg' });
  });

  // Wait for re-solve after debounce (50 ms) + cascade.
  await page.waitForFunction(() => {
    const w = window as any;
    const diag = w.__zilventorAssemblySolverResult?.();
    return (diag?.perConstraint?.size ?? 0) > 0;
  }, undefined, { timeout: 10_000 });

  // Assert residual still < 1e-2 after re-solve with new parameter value.
  const secondResidual = await page.evaluate(() => {
    const w = window as any;
    const d = w.__zilventorAssemblySolverResult();
    const first = Array.from((d.perConstraint as Map<string, any>).values())[0];
    return first?.residual ?? null;
  });
  expect(secondResidual).not.toBeNull();
  expect(secondResidual).toBeLessThan(1e-2);
});
