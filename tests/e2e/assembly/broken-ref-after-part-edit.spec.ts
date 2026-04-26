import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';

/**
 * T44: E2E — broken-ref badge after part edit.
 *
 * Strategy:
 *  1. Seed cube part, place twice, mate them, assert solver converges.
 *  2. Simulate a broken ref: inject a bad constraint directly into the store
 *     that references a non-existent feature ID (featureId: 'DELETED').
 *     This mimics what happens after a referenced face's owning feature is
 *     deleted — the kernel can't resolve it and the solver flags brokenRef=true.
 *  3. Assert the broken-ref constraint shows brokenRef=true in diagnostics.
 *
 * Note: A full single-document part-edit flow via E2E (close assembly, edit part,
 * delete feature, re-open) is too complex at this stage. The broken-ref state
 * is simulated by direct store mutation, which is the exact code path the solver
 * exercises when it can't resolve a ref (resolvedRefs map has no entry for the key).
 */
test('T44 — broken-ref badge after simulated part edit', async ({ page }) => {
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

  // Add a valid mate constraint.
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

  // Wait for initial solve (should converge with brokenRef=false).
  await page.waitForFunction(() => {
    const w = window as any;
    const diag = w.__zilventorAssemblySolverResult?.();
    return (diag?.perConstraint?.size ?? 0) > 0;
  }, undefined, { timeout: 10_000 });

  const initialEntry = await page.evaluate(() => {
    const w = window as any;
    const d = w.__zilventorAssemblySolverResult();
    return Array.from((d.perConstraint as Map<string, any>).values())[0] ?? null;
  });
  expect(initialEntry).not.toBeNull();
  expect(initialEntry!.brokenRef).toBe(false);

  // Simulate part edit: mutate the constraint in the store to reference a deleted
  // feature ('DELETED'). The ref resolver will fail to find it → brokenRef=true.
  await page.evaluate(([c1Id, c2Id]) => {
    const store = (window as any).__zilventorStore.getState();
    const assembly = store.activeAssembly;
    const constraint = assembly.constraints[0];
    if (!constraint) return;
    // Replace refA to point at a deleted feature.
    const badConstraint = {
      ...constraint,
      refA: { kind: 'face', componentId: c1Id, face: { featureId: 'DELETED', role: 'top', instance: 0 } },
    };
    store.updateAssemblyConstraint(constraint.id, badConstraint);
  }, [c1, c2]);

  // Wait for re-solve with broken ref.
  await page.waitForFunction(() => {
    const w = window as any;
    const diag = w.__zilventorAssemblySolverResult?.();
    if ((diag?.perConstraint?.size ?? 0) === 0) return false;
    const first = Array.from((diag.perConstraint as Map<string, any>).values())[0];
    return first?.brokenRef === true;
  }, undefined, { timeout: 10_000 });

  const brokenEntry = await page.evaluate(() => {
    const w = window as any;
    const d = w.__zilventorAssemblySolverResult();
    return Array.from((d.perConstraint as Map<string, any>).values())[0] ?? null;
  });
  expect(brokenEntry).not.toBeNull();
  expect(brokenEntry!.brokenRef).toBe(true);
});
