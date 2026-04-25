import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * Work-feature parametric-cascade E2E (plan T40).
 *
 * Builds a part with:
 *   - parameter `d_off` = 25 mm
 *   - WP1: workPlane offsetFromPlane(origin.XY, =d_off)
 *   - SKT: sketch on WP1 (rectangle 10×10)
 *   - EXT: extrude SKT 5 mm — produces a box whose Z position depends on d_off
 *
 * Editing `d_off` from 25 → 50 must shift the box +25 mm along Z, which
 * shows up as a different geometry hash. This tests the full sketch-on-
 * derived-plane cascade chain (parameter → workPlane.evaluate → SketchFrame
 * → ExtrudeFeature).
 */
test('editing the offset parameter cascades through workPlane to the dependent extrude', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // 1. Seed parameter d_off=25, parametric workPlane, sketch on it, extrude.
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
      name: 'd_off', expression: '25', value: 25, unit: 'mm',
    });
    await s.kernel.setParameter(s.activePart!.id, {
      name: 'd_ext', expression: '5', value: 5, unit: 'mm',
    });
    await s.kernel.addFeature(s.activePart!.id, {
      kind: 'workPlane',
      id: 'WP1',
      visible: true,
      source: {
        mode: 'offsetFromPlane',
        plane: { source: 'workPlane', featureId: 'origin.XY' },
        offset: { kind: 'param', paramName: 'd_off' },
      },
    });
    await s.kernel.addFeature(s.activePart!.id, {
      kind: 'sketch',
      id: 'SKT',
      plane: { source: 'workPlane', featureId: 'WP1' },
      primitives: [{ id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 10, h: 10 }],
      constraints: [],
    });
    await s.kernel.addFeature(s.activePart!.id, {
      kind: 'extrude',
      id: 'EXT',
      sketchRef: 'SKT',
      distanceParam: 'd_ext',
      direction: 'forward',
      operation: 'new',
    });
    await s.kernel.execute(s.activePart!.id);
    const next = await s.kernel.getPart(s.activePart!.id);
    s.setActivePart(next);
  });

  // 2. Wait for the viewport to render the box and capture the hash.
  const viewport = page.locator('[data-testid="viewport"]');
  await expect(viewport).toHaveAttribute('data-geometry-hash', /^[0-9a-f]+$/);
  // Poll until the hash settles to a stable non-zero value (the initial
  // setMesh runs async after kernel.execute resolves).
  await expect.poll(async () => {
    const h = await viewport.getAttribute('data-geometry-hash');
    return h && h !== '0' ? h : null;
  }, { timeout: 10_000 }).not.toBeNull();
  const hashBefore = await viewport.getAttribute('data-geometry-hash');
  expect(hashBefore).toBeTruthy();

  // 3. Edit d_off from 25 → 50. The cascade flows:
  //    setParameter → executeTree → WP1 origin moves +25 mm along Z →
  //    sketch frame on WP1 follows → extrude box translates +25 mm.
  await page.evaluate(async () => {
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
    await s.kernel.setParameter(s.activePart!.id, {
      name: 'd_off', expression: '50', value: 50, unit: 'mm',
    });
    await s.kernel.execute(s.activePart!.id);
    const next = await s.kernel.getPart(s.activePart!.id);
    s.setActivePart(next);
  });

  // 4. Assert the geometry hash changed — the extrude box moved +25 mm.
  await expect
    .poll(async () => viewport.getAttribute('data-geometry-hash'), {
      timeout: 15_000,
      message: 'expected geometry hash to change after work-plane offset parameter update',
    })
    .not.toBe(hashBefore);
});
