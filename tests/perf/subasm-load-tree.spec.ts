import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../e2e/helpers/buildBox';
import { seedAssemblyCubePart } from '../e2e/helpers/seedAssemblyPart';
import { seedSubAssemblyZiasm, makeSubAsmDoc } from '../e2e/helpers/seedSubAssembly';

/**
 * T45 (4d Phase 12): Perf — cold-cache `loadSubAssemblyTree` p95 < 1500 ms
 * for a 50-leaf tree.
 *
 * Tree:
 *   parts/cube.zipt (panel)
 *     ↑ × 5
 *   drawer.ziasm (5 panels)
 *     ↑ × 2
 *   cabinet.ziasm (2 drawers = 10 panels)
 *     ↑ × 5 (top assembly)
 *
 * Total leaves = 5 × 2 × 5 = 50.
 *
 * Each trial:
 *   1. Clear `subAssemblyDocs` in the store (cold cache).
 *   2. Time `__zilventorLoadSubAsmTree()` — walks the active assembly,
 *      reads each unique `.ziasm` from OPFS, and unpacks it.
 *
 * 10 trials; expect p95 < 1500 ms.
 */
test('Perf: cold-cache loadSubAssemblyTree p95 < 1500ms for 50-leaf tree', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await seedAssemblyCubePart(page);

  // drawer.ziasm: 5 panels.
  const drawer = makeSubAsmDoc('drawer', Array.from({ length: 5 }, (_, i) => ({
    id: `pa${i}`,
    partPath: 'parts/cube.zipt',
    position: { x: i * 60, y: 0, z: 0 },
    rotation: { rx: 0, ry: 0, rz: 0 },
    visible: true,
  })));
  await seedSubAssemblyZiasm(page, 'drawer.ziasm', drawer);

  // cabinet.ziasm: 2 drawers.
  const cabinet = makeSubAsmDoc('cabinet', Array.from({ length: 2 }, (_, i) => ({
    id: `da${i}`,
    partPath: 'drawer.ziasm',
    position: { x: 0, y: i * 200, z: 0 },
    rotation: { rx: 0, ry: 0, rz: 0 },
    visible: true,
  })));
  await seedSubAssemblyZiasm(page, 'cabinet.ziasm', cabinet);

  // Top assembly: 5 cabinets, programmatically.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  await page.evaluate(() => {
    const w = window as any;
    const store = w.__zilventorStore;
    for (let i = 0; i < 5; i++) {
      store.getState().addComponent({
        id: `cab${i}`,
        partPath: 'cabinet.ziasm',
        position: { x: i * 1000, y: 0, z: 0 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
      });
    }
  });

  await page.waitForFunction(() => {
    const w = window as any;
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 5;
  });

  // Warm-up to settle JIT.
  await page.evaluate(async () => {
    const w = window as any;
    await w.__zilventorLoadSubAsmTree();
  });

  // 10 trials: clear store cache → time loadSubAsmTree.
  const samples: number[] = await page.evaluate(async () => {
    const w = window as any;
    const out: number[] = [];
    for (let i = 0; i < 10; i++) {
      w.__zilventorStore.getState().setSubAssemblyDocs({});
      const t0 = performance.now();
      await w.__zilventorLoadSubAsmTree();
      out.push(performance.now() - t0);
    }
    return out;
  });
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.floor(samples.length * 0.95)]!;
  const p50 = samples[Math.floor(samples.length * 0.50)]!;
  console.log(JSON.stringify({
    metric: 'subasm-load-tree-p95-ms',
    value: p95,
    p50Ms: p50.toFixed(2),
    minMs: samples[0]!.toFixed(2),
    maxMs: samples[samples.length - 1]!.toFixed(2),
    leaves: 50,
    trials: 10,
  }));
  expect(p95).toBeGreaterThanOrEqual(0);
  expect(p95).toBeLessThan(1500);
});
