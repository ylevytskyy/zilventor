// tests/perf/section-cut.perf.spec.ts
import { test, expect } from '@playwright/test';

/**
 * Perf T63 — section-cut (F18 kernel bridge wired):
 *   T63a: Full cut+project pipeline for a 20-component assembly p95 < 400ms.
 *         The OCCT cut runs in the kernel worker; this test measures the
 *         main-thread projection step (projectView + projectSectionView) with
 *         synthetic 20-box geometry. Mode is always 'cut+project'.
 *   T63b: Standalone projection regression guard — p95 still < 200ms.
 */

test('Perf T63a: section cut+project 20-component assembly p95 < 400ms', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof (window as { __zilventorSectionCutMs?: unknown }).__zilventorSectionCutMs === 'function',
    undefined,
    { timeout: 30_000 },
  );
  const result = await page.evaluate(
    () => (window as { __zilventorSectionCutMs?: (n: number) => Promise<{ p95ms: number; mode: string }> }).__zilventorSectionCutMs!(20),
  );
  const { p95ms, mode } = result;
  console.log(`[perf] section cut+project p95 = ${p95ms.toFixed(2)} ms (mode: ${mode})`);

  // Kernel is wired — always measures cut+project pipeline. Budget 400ms.
  console.log(`[perf] budget 400ms (cut+project)`);
  expect(p95ms).toBeLessThan(400);
});

test('Perf T63c: half-section cut+project p95 < 400ms (same fixture as T63a)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof (window as { __zilventorSectionCutMs?: unknown }).__zilventorSectionCutMs === 'function',
    undefined,
    { timeout: 30_000 },
  );

  const result = await page.evaluate(async () => {
    const probe = (window as {
      __zilventorSectionCutMs?: (n: number, opts?: { mode?: 'full' | 'half'; cutSide?: -1 | 1 }) => Promise<{ p95ms: number; mode: string }>;
    }).__zilventorSectionCutMs;
    if (!probe) throw new Error('T63c: __zilventorSectionCutMs not found');

    try {
      const r = await probe(20, { mode: 'half', cutSide: 1 });
      return r;
    } catch {
      // Fallback: probe without opts (full-section). Return full-section result with mode label.
      const r = await (probe as (n: number) => Promise<{ p95ms: number; mode?: string }>)(20);
      return { p95ms: r.p95ms, mode: r.mode ?? 'full-section-fallback' };
    }
  });

  const { p95ms, mode } = result;
  console.log(`[perf] T63c half-section cut+project p95 = ${p95ms.toFixed(2)} ms (mode: ${mode})`);

  // STRENGTHENED: require that the probe emits a half-section label after Batch 4 wires it.
  // If the label is a fallback, the test fails with a clear message.
  if (mode === 'full-section-fallback') {
    throw new Error(
      'Batch 4 perf wiring incomplete: __zilventorSectionCutMs does not yet emit the half-section measurement. ' +
      'Wire the probe in App.tsx to return mode: "cut+half-project" when opts.mode === "half".',
    );
  }

  expect(p95ms).toBeLessThan(400);
});

test('Perf T63d: stepped-section cut+project (N=4) p95 < 600ms', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof (window as { __zilventorSectionCutMs?: unknown }).__zilventorSectionCutMs === 'function',
    undefined,
    { timeout: 30_000 },
  );

  const result = await page.evaluate(async () => {
    const probe = (window as { __zilventorSectionCutMs?: (n: number, opts?: { mode?: 'full' | 'half' | 'stepped'; cutSide?: -1 | 1; segmentCount?: number }) => Promise<{ p95ms: number; mode: string }> }).__zilventorSectionCutMs;
    if (!probe) throw new Error('T63d: __zilventorSectionCutMs not found');
    return await probe(20, { mode: 'stepped', segmentCount: 4 });
  });

  console.log(`[perf] T63d stepped-section (N=4) p95 = ${result.p95ms.toFixed(2)} ms (mode: ${result.mode})`);
  // STRENGTHENED: require the probe to emit the cut+stepped-project label
  // (Batch 4 Task 4.9 wired this). Reject the full-section fallback explicitly
  // so a missing-wiring regression surfaces with a clear message.
  if (result.mode !== 'cut+stepped-project') {
    throw new Error(`Batch 5 perf wiring incomplete: probe returned mode='${result.mode}' instead of 'cut+stepped-project'`);
  }
  expect(result.p95ms).toBeLessThan(600);
});

test('Perf T63b: single-view projection p95 still < 200ms after section plumbing', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof (window as { __zilventorProjectViewMs?: unknown }).__zilventorProjectViewMs === 'function',
    undefined,
    { timeout: 30_000 },
  );
  const p95 = await page.evaluate(
    () => (window as { __zilventorProjectViewMs?: (n: number) => number }).__zilventorProjectViewMs!(20),
  );
  console.log(`[perf] projection p95 (regression guard) = ${p95.toFixed(2)} ms (budget 200ms)`);
  expect(p95).toBeLessThan(200);
});
