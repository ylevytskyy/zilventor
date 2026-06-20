import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';

/**
 * S-A: Assembly reflow after part invalidation (Task 1 reflow wiring).
 *
 * Tests that __zilventorAssemblyInvalidatePart('parts/cube.zipt') correctly:
 *   1. Triggers solverDirty = true (the invalidate hook bumps solverDirty).
 *   2. The solver runs and converges (solverDirty returns to false).
 *   3. Existing constraints remain brokenRef=false (the part file is unchanged;
 *      we only invalidate the caches, not alter the features like T44 does).
 *
 * Strategy:
 *  1. Seed cube part, place 3 instances.
 *  2. Add two constraints:  c1.top ↔ c2.bottom  and  c2.top ↔ c3.bottom.
 *  3. Wait for initial solve — assert brokenRef=false on both constraints.
 *  4. Call __zilventorAssemblyInvalidatePart('parts/cube.zipt').
 *  5. Assert solverDirty transitions true then false (reflow fires).
 *  6. Assert both constraints still brokenRef=false (part unchanged).
 */
test('S-A — assembly reflow after part invalidation (solverDirty cycle, brokenRef stable)', async ({ page }) => {
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

  // Place cube 3 times.
  for (let i = 0; i < 3; i++) {
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
  expect(componentIds).toHaveLength(3);
  const [c1, c2, c3] = componentIds as [string, string, string];

  // ----- Add constraint 1: c1.top ↔ c2.bottom -----
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

  // ----- Add constraint 2: c2.top ↔ c3.bottom -----
  await page.getByRole('button', { name: 'Mate' }).click();
  await expect(page.getByRole('dialog', { name: /place constraint/i })).toBeVisible();

  await page.getByRole('button', { name: /^pick…$/i }).first().click();
  await page.evaluate(([id]) => {
    (window as any).__zilventorAssemblyPickerSimulate('A', 'face', {
      componentId: id,
      face: { featureId: 'E1', role: 'top', instance: 0 },
    });
  }, [c2]);

  await page.getByRole('button', { name: /^pick…$/i }).nth(1).click();
  await page.evaluate(([id]) => {
    (window as any).__zilventorAssemblyPickerSimulate('B', 'face', {
      componentId: id,
      face: { featureId: 'E1', role: 'bottom', instance: 0 },
    });
  }, [c3]);

  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('dialog', { name: /place constraint/i })).toBeHidden();

  // Wait for initial solve — 2 constraints must be registered.
  await page.waitForFunction(() => {
    const w = window as any;
    const diag = w.__zilventorAssemblySolverResult?.();
    return (diag?.perConstraint?.size ?? 0) >= 2;
  }, undefined, { timeout: 15_000 });

  // Assert both constraints have brokenRef=false after initial solve.
  const initialEntries = await page.evaluate(() => {
    const w = window as any;
    const d = w.__zilventorAssemblySolverResult();
    return Array.from((d.perConstraint as Map<string, any>).values()).map((v) => ({
      brokenRef: v.brokenRef,
    }));
  });
  expect(initialEntries).toHaveLength(2);
  for (const entry of initialEntries) {
    expect(entry.brokenRef).toBe(false);
  }

  // ----- Invalidate the part (Task 1 reflow wiring) -----
  // Mark solverDirty=false before invalidating so we can detect the transition.
  await page.evaluate(() => {
    const s = (window as any).__zilventorStore.getState();
    s.setSolverDirty(false);
  });

  // Now call invalidate — it should bump solverDirty=true immediately.
  await page.evaluate(async () => {
    await (window as any).__zilventorAssemblyInvalidatePart('parts/cube.zipt');
  });

  // Assert solverDirty went true (Task 1: the hook bumps solverDirty=true).
  const wentDirty = await page.evaluate(() => {
    return (window as any).__zilventorStore.getState().solverDirty;
  });
  expect(wentDirty).toBe(true);

  // Wait for the solver to re-run and solverDirty to return to false.
  // The solver debounces 50ms then runs; afterwards setSolverDirty(false) is called.
  await page.waitForFunction(() => {
    const s = (window as any).__zilventorStore.getState();
    return s.solverDirty === false;
  }, undefined, { timeout: 15_000 });

  // Assert constraints are STILL brokenRef=false after reflow.
  // The part file is unchanged; only caches were dropped.
  // The solver re-loaded the same part bytes and re-resolved the same refs.
  await page.waitForFunction(() => {
    const w = window as any;
    const diag = w.__zilventorAssemblySolverResult?.();
    if ((diag?.perConstraint?.size ?? 0) < 2) return false;
    return Array.from((diag.perConstraint as Map<string, any>).values()).every((v) => v.brokenRef === false);
  }, undefined, { timeout: 15_000 });

  const reflowEntries = await page.evaluate(() => {
    const w = window as any;
    const d = w.__zilventorAssemblySolverResult();
    return Array.from((d.perConstraint as Map<string, any>).values()).map((v) => ({
      brokenRef: v.brokenRef,
    }));
  });
  expect(reflowEntries).toHaveLength(2);
  for (const entry of reflowEntries) {
    // Key assertion: after reflow, same unchanged part → refs still resolve.
    expect(entry.brokenRef).toBe(false);
  }
});
