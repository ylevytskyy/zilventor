import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * Sweep parametric-cascade E2E test.
 *
 * Sweep has no ParamOrLiteral fields of its own — its geometry is entirely
 * driven by the profile and path sketches. The cascade test therefore proves
 * "the swept body regenerates when the underlying path sketch changes".
 *
 * Setup:
 *   - PROF: circle (r=1) on XY plane — closed-wire profile
 *   - PATH: line (0,0)→(0,10) on XZ plane — open-wire path, 10 mm sweep length
 *   - SW1: sweep referencing PROF + PATH
 *
 * Cascade trigger: remove PATH and re-add it with endpoint (0,20) — 20 mm path.
 * Then call kernel.execute and assert the viewport geometry hash changes.
 *
 * Pattern mirrors hole-parametric-cascade.spec.ts (T27/T28).
 */
test('changing the path sketch regenerates the swept body', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // 1. Seed profile + path sketches and the sweep feature directly via kernel API.
  await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          kernel: {
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
    // Profile: circle (closed wire) on XY
    await s.kernel.addFeature(s.activePart!.id, {
      kind: 'sketch',
      id: 'PROF',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [{ id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 1 }],
      constraints: [],
    });
    // Path: line 10 mm along Z on XZ
    await s.kernel.addFeature(s.activePart!.id, {
      kind: 'sketch',
      id: 'PATH',
      plane: { source: 'workPlane', featureId: 'origin.XZ' },
      primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }],
      constraints: [],
    });
    // Sweep feature
    await s.kernel.addFeature(s.activePart!.id, {
      kind: 'sweep',
      id: 'SW1',
      profileSketchId: 'PROF',
      pathSketchId: 'PATH',
      orientation: { kind: 'path' },
      operation: 'new',
    });
    await s.kernel.execute(s.activePart!.id);
    const next = await s.kernel.getPart(s.activePart!.id);
    s.setActivePart(next);
  });

  // 2. Wait for a geometry hash reflecting the swept cylinder.
  const viewport = page.locator('[data-testid="viewport"]');
  await expect(viewport).toHaveAttribute('data-geometry-hash', /^[0-9a-f]+$/);
  const hashBefore = await viewport.getAttribute('data-geometry-hash');
  expect(hashBefore).toBeTruthy();

  // 3. Cascade trigger: replace PATH with a longer line (20 mm) and re-execute.
  //    This changes the swept body length, which must propagate to the viewport.
  await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          kernel: {
            removeFeature(partId: string, featureId: string): Promise<void>;
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
    await s.kernel.removeFeature(s.activePart!.id, 'PATH');
    await s.kernel.addFeature(s.activePart!.id, {
      kind: 'sketch',
      id: 'PATH',
      plane: { source: 'workPlane', featureId: 'origin.XZ' },
      primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 20 }],
      constraints: [],
    });
    await s.kernel.execute(s.activePart!.id);
    const next = await s.kernel.getPart(s.activePart!.id);
    s.setActivePart(next);
  });

  // 4. Assert the geometry hash changed — the 20 mm cylinder differs from the 10 mm one.
  await expect
    .poll(async () => viewport.getAttribute('data-geometry-hash'), {
      timeout: 15_000,
      message: 'expected geometry hash to change after path sketch update',
    })
    .not.toBe(hashBefore);

  const hashAfter = await viewport.getAttribute('data-geometry-hash');
  expect(hashAfter).toBeTruthy();
  expect(hashAfter).not.toBe(hashBefore);
});
