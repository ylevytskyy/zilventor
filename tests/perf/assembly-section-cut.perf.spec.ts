// tests/perf/assembly-section-cut.perf.spec.ts
/**
 * T63m — N-component assembly section cut p95 performance (pose-aware kernel path).
 *
 * Probes `cutAssemblyComponentsBySectionPlane` via the __zilventorAsmSectionCutMs hook,
 * which calls the real OCCT kernel (no projection — pure cut latency over Comlink).
 *
 * Fixture: N=10 leaves of the active part at distinct X translations (30mm stride).
 * Iterations: 10 cuts, p95 measured.
 * Budget: 2000ms (generous; observed p95 ~1265ms on first run — 10 sequential OCCT
 *         BRepAlgoAPI_Cut calls over Comlink; projection step NOT included here).
 * Note: N=10 cuts > 10× the single-part section cut cost because each leaf requires
 *       an independent kernel round-trip (pose transform + boolean op).
 *
 * Requires an active part in the kernel (hook returns 0 if none).
 * Builds a box first via buildBox to warm the kernel and set activePart.
 */
import { test, expect } from '@playwright/test';
import { buildBox, waitForKernelReady } from '../e2e/helpers/buildBox';

test('Perf T63m: 10-leaf assembly section cut p95 < 2000ms', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // Build a 20×20×15 box — the hook reuses this part ID for all 10 synthetic leaves.
  await buildBox(page, { width: 20, height: 20, depth: 15 });

  await page.waitForFunction(
    () => typeof (window as { __zilventorAsmSectionCutMs?: unknown }).__zilventorAsmSectionCutMs === 'function',
    undefined,
    { timeout: 30_000 },
  );

  // Run 10 iterations of the 10-leaf assembly section cut.
  const p95 = await page.evaluate(
    () =>
      (window as { __zilventorAsmSectionCutMs?: (n: number, leafCount?: number) => Promise<number> }).__zilventorAsmSectionCutMs!(
        10,
        10,
      ),
  );

  console.log(`[perf] T63m assembly section cut (10 leaves) p95 = ${p95.toFixed(2)} ms (budget 2000ms; observed ~1265ms)`);
  expect(p95, 'T63m p95 must be > 0 (hook must run a real kernel cut, not return early)').toBeGreaterThan(0);
  expect(p95, 'T63m p95 must be < 2000ms (N=10 assembly section cut budget)').toBeLessThan(2000);
});
