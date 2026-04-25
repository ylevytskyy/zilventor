import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../e2e/helpers/buildBox';

/**
 * Work-features perf budget (plan T42).
 *
 * Builds a part with 20 user-created work planes that each depend on
 * a parameter, then changes one upstream parameter that cascades to all
 * 20 planes. Measures the end-to-end recompute time (kernel.execute).
 *
 * Budget: < 1500 ms for 20 work-feature recomputes. The kernel is
 * not yet optimized for work-feature-only recomputes (each call still
 * runs a full executeTree pass), so this is a soft budget intended
 * to catch regressions, not to drive aggressive optimisation.
 */
test('Perf: 20-workPlane parametric recompute under 1500 ms', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // 1. Seed parameter d_off=10 and 20 work planes that each offset by =d_off
  //    from the previous plane (or origin.XY for the first).
  await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          kernel: {
            setParameter(partId: string, param: unknown): Promise<void>;
            addFeature(partId: string, feature: unknown): Promise<void>;
            execute(partId: string): Promise<unknown>;
            getPart(partId: string): Promise<unknown>;
          };
          activePart: { id: string } | null;
          setActivePart(p: unknown): void;
        };
      };
    };
    const s = w.__zilventorStore.getState();
    await s.kernel.setParameter(s.activePart!.id, {
      name: 'd_off', expression: '10', value: 10, unit: 'mm',
    });
    let prevPlaneId = 'origin.XY';
    for (let i = 0; i < 20; i++) {
      const id = `WP${i + 1}`;
      await s.kernel.addFeature(s.activePart!.id, {
        kind: 'workPlane',
        id,
        visible: false,
        source: {
          mode: 'offsetFromPlane',
          plane: { source: 'workPlane', featureId: prevPlaneId },
          offset: { kind: 'param', paramName: 'd_off' },
        },
      });
      prevPlaneId = id;
    }
    await s.kernel.execute(s.activePart!.id);
    const next = await s.kernel.getPart(s.activePart!.id);
    s.setActivePart(next);
  });

  // 2. Change d_off and time the recompute.
  const totalMs = await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          kernel: {
            setParameter(partId: string, param: unknown): Promise<void>;
            execute(partId: string): Promise<unknown>;
            getPart(partId: string): Promise<unknown>;
          };
          activePart: { id: string } | null;
          setActivePart(p: unknown): void;
        };
      };
    };
    const s = w.__zilventorStore.getState();
    const t0 = performance.now();
    await s.kernel.setParameter(s.activePart!.id, {
      name: 'd_off', expression: '20', value: 20, unit: 'mm',
    });
    await s.kernel.execute(s.activePart!.id);
    const next = await s.kernel.getPart(s.activePart!.id);
    s.setActivePart(next);
    return performance.now() - t0;
  });
  console.log(JSON.stringify({ metric: 'work-features-recompute', planes: 20, totalMs }));
  expect(totalMs).toBeLessThan(1500);
});
