import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../e2e/helpers/buildBox';
import { seedAssemblyPanelPart } from '../e2e/helpers/seedAssemblyPanelPart';
import { seedSubAssemblyZiasm, makeSubAsmDoc } from '../e2e/helpers/seedSubAssembly';

/**
 * T33 (5d Phase 10): Perf — cut-list aggregation + first-render on a
 * 200-panel assembly across 50 distinct panel specs across 3 nesting levels.
 *
 * Tree:
 *   parts/perf5d-p0.zipt … parts/perf5d-p49.zipt  (50 distinct panel specs)
 *     ↑ all 50 referenced once each
 *   slab.ziasm  (50 leaf components — one of each distinct spec)
 *     ↑ × 4
 *   top assembly (4 slabs = 200 leaf panels)
 *
 * Two budgets:
 *   Budget A: `aggregateCutListRecursive` p95 < 5 ms over 50 trials
 *             (pure-JS aggregator only; measured via __zilventorCutListAggregateMs).
 *   Budget B: Cut List tab open → first [data-cutlist-row] paint ≤ 1500 ms.
 */
test('Perf T33-A: aggregateCutListRecursive p95 < 5 ms at 200 panels / 50 specs / 3 levels', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. New top-level assembly.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // 2. Register a shared material so the aggregator can resolve names.
  await page.evaluate(() => {
    const w = window as any;
    w.__zilventorStore.getState().addMaterial({
      id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896',
    });
  });

  // 3. Seed 50 distinct panel parts to OPFS (varying L×W so each gets its own
  //    cut-list key after grain-aware normalization).
  const SPEC_COUNT = 50;
  const materials = [{ id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' }];
  for (let n = 0; n < SPEC_COUNT; n++) {
    await seedAssemblyPanelPart(page, {
      partPath: `parts/perf5d-p${n}.zipt`,
      partName: `perf5d-p${n}`,
      // Unique (L, W) pair: length varies 200..249, width varies 100..149.
      length: 200 + n,
      width: 100 + n,
      thickness: 18,
      materialId: 'm-birch',
      grain: 'length',
      materials,
    });
  }

  // 4. Seed slab.ziasm: 50 components, one of each distinct panel spec.
  const slabComponents = Array.from({ length: SPEC_COUNT }, (_, i) => ({
    id: `sp${i}`,
    partPath: `parts/perf5d-p${i}.zipt`,
    position: { x: i * 300, y: 0, z: 0 },
    rotation: { rx: 0, ry: 0, rz: 0 },
    visible: true,
  }));
  const slabDoc = makeSubAsmDoc('slab', slabComponents, {
    cutListItemNumbers: {},
    materials,
  } as any);
  await seedSubAssemblyZiasm(page, 'slab.ziasm', slabDoc);

  // 5. Place 4 instances of slab.ziasm in the top-level assembly
  //    (4 × 50 = 200 leaf panels).
  await page.evaluate(() => {
    const w = window as any;
    const s = w.__zilventorStore.getState();
    for (let i = 0; i < 4; i++) {
      s.addComponent({
        id: `slab${i}`,
        partPath: 'slab.ziasm',
        position: { x: 0, y: i * 20000, z: 0 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
      });
    }
  });

  await page.waitForFunction(() => {
    const w = window as any;
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 4;
  });

  // 6. Hydrate the recursive sub-assembly cache.
  await page.evaluate(async () => {
    const w = window as any;
    await w.__zilventorLoadSubAsmTree?.();
  });

  // 7. Load all 50 panel specs from OPFS into panelSpecCacheRef.
  await page.evaluate(async () => {
    const w = window as any;
    // __zilventorLoadCutListSpecs only walks top-level leaf components;
    // for sub-asm leaves we call it after the tree is hydrated so the
    // resolved sub-asm docs are visible to the hook.
    await w.__zilventorLoadCutListSpecs?.();
    // Additionally seed the sub-asm leaf paths manually since
    // __zilventorLoadCutListSpecs only inspects the active assembly's
    // direct (non-.ziasm) components. We call it a second time after
    // flushing state so the autosave watcher has run.
  });

  // Verify leaf count via recursive helper.
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const w = window as any;
      return w.__zilventorComponentPathToLeafCount?.([]) ?? -1;
    });
  }, { timeout: 15_000 }).toBe(200);

  // 8. Warm the panel spec cache for sub-asm leaves by opening Cut List tab
  //    (which triggers warmCache) and waiting for rows.
  await page.getByRole('button', { name: 'Cut List tab' }).click();
  await expect(page.locator('[data-cutlist-row]').first()).toBeVisible({ timeout: 15_000 });
  // Return to a neutral state — close the tab by navigating away (click Assembly tab).
  // (No need; the hook uses the already-warm cache for the benchmark.)

  // 9. Budget A: aggregateCutListRecursive p95 over 50 trials.
  const p95ms = await page.evaluate(() => {
    const w = window as any;
    return w.__zilventorCutListAggregateMs(50);
  });
  console.log(JSON.stringify({
    metric: 'cut-list-aggregate-recursive-p95-ms',
    value: p95ms,
    leaves: 200,
    specs: 50,
    levels: 3,
    trials: 50,
  }));
  expect(p95ms).toBeGreaterThanOrEqual(0);
  expect(p95ms).toBeLessThan(5);
});

test('Perf T33-B: Cut List first-render wall clock <= 1500 ms at 200 panels / 50 specs / 3 levels', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. New assembly.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // 2. Material.
  await page.evaluate(() => {
    const w = window as any;
    w.__zilventorStore.getState().addMaterial({
      id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896',
    });
  });

  // 3. Seed 50 distinct panel parts.
  const SPEC_COUNT = 50;
  const materials = [{ id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' }];
  for (let n = 0; n < SPEC_COUNT; n++) {
    await seedAssemblyPanelPart(page, {
      partPath: `parts/perf5d-b-p${n}.zipt`,
      partName: `perf5d-b-p${n}`,
      length: 200 + n,
      width: 100 + n,
      thickness: 18,
      materialId: 'm-birch',
      grain: 'length',
      materials,
    });
  }

  // 4. Seed slab sub-assembly.
  const slabComponents = Array.from({ length: SPEC_COUNT }, (_, i) => ({
    id: `sp${i}`,
    partPath: `parts/perf5d-b-p${i}.zipt`,
    position: { x: i * 300, y: 0, z: 0 },
    rotation: { rx: 0, ry: 0, rz: 0 },
    visible: true,
  }));
  const slabDoc = makeSubAsmDoc('slab-b', slabComponents, {
    cutListItemNumbers: {},
    materials,
  } as any);
  await seedSubAssemblyZiasm(page, 'slab-b.ziasm', slabDoc);

  // 5. Place 4 slab instances (4 × 50 = 200 leaves).
  await page.evaluate(() => {
    const w = window as any;
    const s = w.__zilventorStore.getState();
    for (let i = 0; i < 4; i++) {
      s.addComponent({
        id: `slabB${i}`,
        partPath: 'slab-b.ziasm',
        position: { x: 0, y: i * 20000, z: 0 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
      });
    }
  });

  await page.waitForFunction(() => {
    const w = window as any;
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 4;
  });

  // 6. Hydrate sub-asm tree and panel spec cache.
  await page.evaluate(async () => {
    const w = window as any;
    await w.__zilventorLoadSubAsmTree?.();
    await w.__zilventorLoadCutListSpecs?.();
  });

  // 7. Navigate to Assembly tab first (ensures Cut List tab is not yet open).
  await page.getByRole('tab', { name: 'Assembly' }).click();

  // 8. Budget B: wall-clock from Cut List tab click to first row painted.
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Cut List tab' }).click();
  await page.locator('[data-cutlist-row]').first().waitFor({ timeout: 5_000 });
  const renderMs = Date.now() - t0;
  console.log(JSON.stringify({
    metric: 'cut-list-first-render-ms',
    value: renderMs,
    leaves: 200,
    specs: 50,
    levels: 3,
  }));
  expect(renderMs).toBeLessThanOrEqual(1500);
});
