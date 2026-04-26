import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCylinderPart } from '../helpers/seedAssemblyCylinderPart';

/**
 * T39: E2E — Insert constraint between two cylindrical parts.
 *
 * Each cylinder has one planar top face (`{featureId:'E1', role:'top'}`)
 * and one cylindrical lateral face (`{featureId:'E1', role:'side',
 * instance:0}`). The shared edge between them is a circle, so the
 * insert constraint's circularEdge ref `{faceA: top, faceB: side}`
 * resolves to a real (axis, plane) pair via `extractAssemblyCircularEdge`.
 *
 * Assertions:
 *   - solver runs (perConstraint has 1 entry)
 *   - brokenRef is false (cylinder edge resolves)
 *   - residual is small (constraint converges)
 */
test('T39 — insert constraint mates two coaxial cylinders', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await seedAssemblyCylinderPart(page);

  // Open a new assembly.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // Place cylinder twice.
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('p');
    await expect(page.getByRole('dialog', { name: /place component/i })).toBeVisible();
    await page.getByText(/^cylinder$/).click();
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
  expect(componentIds).toHaveLength(2);
  const [c1, c2] = componentIds as [string, string];

  // Drive the insert constraint dialog via 'i' hotkey.
  await page.keyboard.press('i');
  await expect(page.getByRole('dialog', { name: /place constraint/i })).toBeVisible();

  // Insert refs use { faceA: planar, faceB: cylindrical } (NOT canonical),
  // so resolveCircularEdgeRef can pick the plane from faceA and the axis
  // from faceB.
  const topCircle = {
    faceA: { featureId: 'E1', role: 'top', instance: 0 },
    faceB: { featureId: 'E1', role: 'side', instance: 0 },
  };

  await page.getByRole('button', { name: /^pick…$/i }).first().click();
  await page.evaluate(([c1Id, edge]) => {
    (window as any).__zilventorAssemblyPickerSimulate('A', 'edge', {
      componentId: c1Id,
      edge,
      isCircular: true,
    });
  }, [c1, topCircle] as const);

  await page.getByRole('button', { name: /^pick…$/i }).nth(1).click();
  await page.evaluate(([c2Id, edge]) => {
    (window as any).__zilventorAssemblyPickerSimulate('B', 'edge', {
      componentId: c2Id,
      edge,
      isCircular: true,
    });
  }, [c2, topCircle] as const);

  // Commit.
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('dialog', { name: /place constraint/i })).toBeHidden();

  // Wait for solver to register the constraint.
  await page.waitForFunction(() => {
    const w = window as any;
    const diag = w.__zilventorAssemblySolverResult?.();
    if (!diag) return false;
    return (diag.perConstraint?.size ?? 0) > 0;
  }, undefined, { timeout: 10_000 });

  const diag = await page.evaluate(() => {
    const w = window as any;
    const d = w.__zilventorAssemblySolverResult();
    const entries = Array.from((d.perConstraint as Map<string, any>).entries());
    return {
      constraintCount: entries.length,
      firstConstraint: entries.length > 0 ? entries[0]![1] : null,
      status: d.status,
    };
  });

  expect(diag.constraintCount).toBe(1);
  expect(diag.firstConstraint).not.toBeNull();
  // Real cylindrical edge → the kernel can resolve circle geometry → not broken.
  expect(diag.firstConstraint!.brokenRef).toBe(false);
  // The insert constraint should converge to a small residual.
  expect(diag.firstConstraint!.residual).toBeLessThan(1e-2);
});
