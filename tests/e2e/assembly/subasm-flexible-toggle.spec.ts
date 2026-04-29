import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';
import { seedSubAssemblyZiasm, makeSubAsmDoc } from '../helpers/seedSubAssembly';

/**
 * T36 (4d Phase 11): toggling Flexible on a placed sub-assembly should
 * change what the parent solver sees.
 *
 * Substantive observable: when the placement is rigid, the inner mate is
 * hidden inside the rigid subtree and does NOT participate in the parent's
 * LM solve — `solverDiagnostics.perConstraint` has 0 entries. When the
 * placement is flexible, flattenForSolver inlines the inner mate with a
 * path-prefixed ref, the parent's LM solves it end-to-end, and
 * `perConstraint` gains an entry for the inlined inner constraint.
 *
 * Drives the toggle through the store's setComponentFlexible (the same
 * action ToggleSubAssemblyFlexibleCommand wraps); the BrowserPane double-
 * click filters out sub-assemblies, so there is no UI route to open the
 * EditComponentDialog for a .ziasm placement today.
 */
test('T36 — toggling Flexible inlines the inner mate into the parent solve', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await seedAssemblyCubePart(page);

  // Sub-asm with two cube leaves and an inner mate constraint.
  const sub = makeSubAsmDoc('subasm', [
    { id: 'a', partPath: 'parts/cube.zipt',
      position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    { id: 'b', partPath: 'parts/cube.zipt',
      position: { x: 0, y: 0, z: 60 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
  ], {
    constraints: [{
      id: 'K_inner',
      kind: 'mate',
      refA: { kind: 'face', componentPath: ['a'], face: { featureId: 'E1', role: 'top', instance: 0 } },
      refB: { kind: 'face', componentPath: ['b'], face: { featureId: 'E1', role: 'bottom', instance: 0 } },
      offset: 0,
      suppressed: false,
    }],
    groundedComponentPaths: [['a']],
  });
  await seedSubAssemblyZiasm(page, 'subasm.ziasm', sub);

  // Open a fresh top assembly and place subasm.ziasm.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  await page.keyboard.press('p');
  await expect(page.getByRole('dialog', { name: /place component/i })).toBeVisible();
  await page.getByText(/^subasm$/).click();
  await page.getByRole('button', { name: /^place$/i }).click();
  await expect(page.getByRole('dialog', { name: /place component/i })).toBeHidden();

  await page.waitForFunction(() => {
    const w = window as any;
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 1;
  });

  // Hydrate the sub-asm cache so flattenForSolver sees the inner mate.
  await page.evaluate(async () => {
    const w = window as any;
    await w.__zilventorLoadSubAsmTree();
    w.__zilventorStore.getState().setSolverDirty(true);
  });

  // Wait for rigid solve. The inner mate stays inside the rigid placement,
  // so the parent's perConstraint map should remain empty.
  await page.waitForTimeout(200);
  const rigidPerConstraintSize = await getPerConstraintSizeStable(page);
  expect(rigidPerConstraintSize).toBe(0);

  // Toggle Flexible on the placed component (same action as
  // ToggleSubAssemblyFlexibleCommand.apply()).
  await page.evaluate(() => {
    const w = window as any;
    const componentId = w.__zilventorStore.getState().activeAssembly.components[0].id;
    w.__zilventorStore.getState().setComponentFlexible(componentId, true);
  });

  // Wait for flexible solve. The inner mate is now inlined → perConstraint
  // gains the K_inner entry.
  const flexiblePerConstraintSize = await getPerConstraintSizeStable(page, 0);
  expect(flexiblePerConstraintSize).toBeGreaterThan(rigidPerConstraintSize);
  expect(flexiblePerConstraintSize).toBe(1);
});

/**
 * Wait for solverDiagnostics.perConstraint.size to settle. If `differFrom`
 * is provided, polls until the size changes (so we read the post-toggle
 * value rather than the pre-toggle one).
 */
async function getPerConstraintSizeStable(
  page: import('@playwright/test').Page,
  differFrom?: number,
): Promise<number> {
  return await page.evaluate(async (differFrom) => {
    const w = window as any;
    const start = Date.now();
    let last = -1;
    while (Date.now() - start < 8000) {
      const diag = w.__zilventorAssemblySolverResult?.();
      if (diag) {
        const size = (diag.perConstraint?.size ?? 0) as number;
        if (differFrom === undefined || size !== differFrom) {
          last = size;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return last;
  }, differFrom);
}
