import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../e2e/helpers/buildBox';

test('Perf: drag-solve on a moderately large constrained sketch', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);

  // Inject a sketch with 50 line primitives + 50 horizontal constraints directly
  // via the dev store hook, then enter sketch mode.
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    // Reset the sample array for this run.
    w.__zilventorDragSolverMsSamples = [] as number[];

    const store = (w.__zilventorStore as { getState(): Record<string, unknown> }).getState() as {
      setActivePart(p: unknown): void;
      setSketchMode(mode: boolean, id?: string): void;
    };

    const primitives: unknown[] = [];
    const constraints: unknown[] = [];
    for (let i = 0; i < 50; i++) {
      const x = (i % 10) * 30;
      const y = Math.floor(i / 10) * 30;
      primitives.push({ id: `L${i}`, kind: 'line', x1: x, y1: y, x2: x + 20, y2: y });
      constraints.push({ id: `c-h-${i}`, kind: 'horizontal', line: `L${i}`, source: 'inferred-migration' });
    }

    store.setActivePart({
      id: 'P1', name: 'Part1', units: 'mm', parameters: {},
      featureTree: [{ kind: 'sketch', id: 'S1', plane: 'XY', primitives, constraints }]
    });
    store.setSketchMode(true, 'S1');
  });

  // Wait for sketch mode to fully load (loadSketch RPC to the sketcher worker).
  await page.waitForTimeout(1500);

  // Ensure the Select tool is active (Escape resets to select in sketch mode).
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Resolve the screen position of the first line's start endpoint (world 0, 0).
  const endpointScreen = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorWorldToScreen?: (x: number, y: number) => { x: number; y: number };
    };
    return w.__zilventorWorldToScreen?.(0, 0) ?? { x: 0, y: 0 };
  });

  // Convert canvas-relative coords to page coords.
  const canvas = page.locator('main#region-viewport canvas');
  const box = (await canvas.boundingBox())!;
  const pageX = box.x + endpointScreen.x;
  const pageY = box.y + endpointScreen.y;

  // Drag from the endpoint across 30 incremental steps.
  const t0 = Date.now();
  await page.mouse.move(pageX, pageY);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) {
    await page.mouse.move(pageX + i * 4, pageY + i * 2, { steps: 1 });
  }
  await page.mouse.up();
  const totalMs = Date.now() - t0;

  // Collect solver timing samples captured by SketcherClient.dragTo instrumentation.
  const { meanSolverMs, samples } = await page.evaluate(() => {
    const w = window as unknown as { __zilventorDragSolverMsSamples?: number[] };
    const arr = w.__zilventorDragSolverMsSamples ?? [];
    const mean = arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    return { meanSolverMs: mean, samples: arr.length };
  });

  console.log(JSON.stringify({ metric: 'drag-constrained-sketch', totalMs, meanSolverMs, samples }));

  // Samples > 0 confirms the drag reached the constraint solver.
  expect(samples).toBeGreaterThan(0);

  // Generous wall-clock cap (CI machines vary widely).
  expect(totalMs).toBeLessThan(10_000);

  // Solver mean cap: spec target is < 5 ms; allow up to 20 ms for slow CI.
  expect(meanSolverMs).toBeLessThan(20);
});
