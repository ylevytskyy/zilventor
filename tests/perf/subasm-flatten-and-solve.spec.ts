import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../e2e/helpers/buildBox';
import { seedAssemblyCubePart } from '../e2e/helpers/seedAssemblyPart';
import { seedSubAssemblyZiasm, makeSubAsmDoc } from '../e2e/helpers/seedSubAssembly';

/**
 * T44 (4d Phase 12): Perf — flattenForSolver + solveAssembly p95 < 200 ms
 * across 5 rigid sub-asms (10 leaves each = 50 leaves) plus 30
 * parent-level mate constraints.
 *
 * Constraints are between rigid sub-asm placements (componentPath =
 * [subId]); the solver sees 5 placement unknowns + 30 mates and runs the
 * full LM iteration. flatten still walks all 50 leaves (skipping them as
 * frozen interior of each rigid subtree).
 *
 * Refs are stub planes injected via the perf hook so we don't pay OCCT
 * cost — same approach as T46 (assembly-solve perf).
 */
test('Perf: flattenForSolver + solveAssembly p95 < 200ms across 5 rigid sub-asms', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await seedAssemblyCubePart(page);

  // sub.ziasm: 10 panels.
  const sub = makeSubAsmDoc('sub', Array.from({ length: 10 }, (_, i) => ({
    id: `pa${i}`,
    partPath: 'parts/cube.zipt',
    position: { x: i * 60, y: 0, z: 0 },
    rotation: { rx: 0, ry: 0, rz: 0 },
    visible: true,
  })));
  await seedSubAssemblyZiasm(page, 'sub.ziasm', sub);

  // Open a fresh top assembly.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // Place 5 rigid sub-asms programmatically + 30 parent-level mate
  // constraints between sub-asm placements.
  await page.evaluate(() => {
    const w = window as any;
    const store = w.__zilventorStore;
    for (let i = 0; i < 5; i++) {
      store.getState().addComponent({
        id: `S${i}`,
        partPath: 'sub.ziasm',
        position: { x: i * 800, y: 0, z: 0 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
      });
    }
    // 30 mates: 4 chain (S0↔S1↔S2↔S3↔S4) + remaining as a star from S0
    // to S1..S4 repeated. 4 + 26 = 30.
    const constraints: any[] = [];
    for (let i = 0; i < 4; i++) {
      constraints.push({
        id: `kc${i}`,
        kind: 'mate',
        suppressed: false,
        refA: { kind: 'face', componentPath: [`S${i}`], face: { featureId: 'E1', role: 'top', instance: 0 } },
        refB: { kind: 'face', componentPath: [`S${i + 1}`], face: { featureId: 'E1', role: 'bottom', instance: 0 } },
        offset: { kind: 'literal', value: 0 },
      });
    }
    for (let i = 0; i < 26; i++) {
      const a = i % 5;
      const b = (i + 1) % 5;
      constraints.push({
        id: `ks${i}`,
        kind: 'mate',
        suppressed: false,
        refA: { kind: 'face', componentPath: [`S${a}`], face: { featureId: 'E1', role: 'top', instance: 0 } },
        refB: { kind: 'face', componentPath: [`S${b}`], face: { featureId: 'E1', role: 'bottom', instance: 0 } },
        offset: { kind: 'literal', value: 0 },
      });
    }
    const cur = store.getState().activeAssembly;
    store.getState().setActiveDocument({
      kind: 'assembly',
      document: { ...cur, constraints, groundedComponentPaths: [['S0']] },
    });
  });

  await page.waitForFunction(() => {
    const w = window as any;
    const a = w.__zilventorStore.getState().activeAssembly;
    return (a?.components?.length ?? 0) === 5 && (a?.constraints?.length ?? 0) === 30;
  });

  // Hydrate the sub-asm cache so flattenForSolver visits all 50 leaves
  // (rigid subtree skip path).
  await page.evaluate(async () => {
    const w = window as any;
    await w.__zilventorLoadSubAsmTree();
  });

  // Sanity: 5 × 10 = 50 leaves visible.
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const w = window as any;
      return w.__zilventorComponentPathToLeafCount?.([]) ?? -1;
    });
  }, { timeout: 10_000 }).toBe(50);

  // Run flatten + solve via dev hook with stub plane refs injected.
  const p95Ms = await page.evaluate(() => {
    const w = window as any;
    return w.__zilventorFlattenAndSolveMs(50);
  });
  console.log(JSON.stringify({
    metric: 'subasm-flatten-and-solve-p95-ms',
    value: p95Ms,
    rigidSubAsms: 5,
    leavesPerSubAsm: 10,
    parentConstraints: 30,
    trials: 50,
  }));
  expect(p95Ms).toBeGreaterThanOrEqual(0);
  expect(p95Ms).toBeLessThan(200);
});
