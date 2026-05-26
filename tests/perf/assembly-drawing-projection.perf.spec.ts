// tests/perf/assembly-drawing-projection.perf.spec.ts
/**
 * T63j — Assembly drawing projection p95 performance.
 *
 * Budget: ~500ms (working budget; real number documented from first run).
 * Fixture: ~10-leaf assembly (10 copies of the active part at distinct poses).
 * Method: window hook __zilventorAsmProjectViewMs registered in App.tsx useEffect (dev mode only).
 *
 * The hook (App.tsx):
 *   1. Snapshots all relevant store fields ONCE before the loop.
 *   2. Sets up a 10-leaf synthetic assembly fixture (activeDrawingSourceComponents).
 *   3. Calls projectViewFromSource('front') N times and measures p95.
 *   4. Restores ALL mutated store fields in a finally block (non-destructive).
 *
 * Requires an active part in the kernel (hook returns 0 if none).
 * We build a box first to ensure the kernel is warm and activePart is set.
 */
import { test, expect } from '@playwright/test';
import { buildBox, waitForKernelReady } from '../e2e/helpers/buildBox';

test('Perf T63j: 10-leaf assembly projection p95 < 500ms', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // Build a box so activePart and kernel are initialized.
  // The hook reuses the active part ID for all 10 synthetic leaves.
  await buildBox(page, { width: 30, height: 30, depth: 10 });

  await page.waitForFunction(
    () => typeof (window as { __zilventorAsmProjectViewMs?: unknown }).__zilventorAsmProjectViewMs === 'function',
    undefined,
    { timeout: 30_000 },
  );

  const p95 = await page.evaluate(
    () => (window as { __zilventorAsmProjectViewMs?: (n: number) => Promise<number> }).__zilventorAsmProjectViewMs!(20),
  );

  console.log(`[perf] T63j assembly projection p95 = ${p95.toFixed(2)} ms (budget 500ms)`);
  expect(p95, `T63j p95 must be > 0 (hook must measure the real path, not return early)`).toBeGreaterThan(0);
  expect(p95, `T63j p95 must be < 500ms (assembly projection budget)`).toBeLessThan(500);
});
