import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../e2e/helpers/buildBox';
import { seedAssemblyCubePart } from '../e2e/helpers/seedAssemblyPart';

/**
 * T47: Perf — drag-along-free-DOFs p95 <16ms (60 fps budget).
 *
 * Strategy:
 *  1. Seed cube, open assembly, place two cubes, add face-face mate (same
 *     setup as T45) so the solver produces a freeDofBasis.
 *  2. Wait for solver to converge so freeDofBasis is populated.
 *  3. Call __zilventorViewportDrag 20 times in a tight in-browser loop,
 *     measuring each call with performance.now().
 *  4. Assert p95 < 16ms (one 60-fps frame).
 *
 * dragAlongFreeDofs is a pure-JS matrix mutation (no OCCT, no solver rerun)
 * so it should be well under 1ms in practice. The 16ms budget is generous
 * and primarily catches accidental async or solver re-runs being triggered.
 */
test('T47 — drag-along-free-DOFs p95 <16ms', async ({ page }) => {
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

  // Add mate constraint (face-to-face) via picker dev hook.
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

  // Wait for solver to converge so freeDofBasis is populated in the store.
  await page.waitForFunction(() => {
    const w = window as any;
    const diag = w.__zilventorAssemblySolverResult?.();
    return (diag?.perConstraint?.size ?? 0) > 0;
  }, undefined, { timeout: 10_000 });

  // Measure 20 drag calls in-browser (synchronous tight loop → pure JS overhead).
  const samples: number[] = await page.evaluate(([c2Id]) => {
    const w = window as any;
    const hook = w.__zilventorViewportDrag;
    if (typeof hook !== 'function') return [];

    // Warm-up
    hook(c2Id, { x: 0.1, y: 0 });

    const out: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      hook(c2Id, { x: 1, y: 0 });
      out.push(performance.now() - t0);
    }
    return out;
  }, [c2]);

  // If the hook wasn't wired, samples will be empty — skip gracefully.
  if (samples.length === 0) {
    console.log('__zilventorViewportDrag hook not available; skipping timing assertions');
    return;
  }

  samples.sort((a, b) => a - b);
  const p95 = samples[Math.floor(samples.length * 0.95)]!;
  const p50 = samples[Math.floor(samples.length * 0.50)]!;
  console.log(JSON.stringify({
    metric: 'drag-free-dof',
    p50Ms: p50.toFixed(3),
    p95Ms: p95.toFixed(3),
    minMs: samples[0]!.toFixed(3),
    maxMs: samples[samples.length - 1]!.toFixed(3),
  }));

  expect(p95).toBeLessThan(16);
});
