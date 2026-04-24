import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedKernelPart } from '../helpers/seedKernelPart';

/**
 * Linear pattern smoke E2E.
 *
 * Seeds a cube (body) + a second smaller extrude (the source) with
 * operation:'join' so it sits atop the cube, then programmatically
 * adds a LinearPatternFeature referencing the source extrude. Asserts
 * the feature tree contains the pattern and the viewport geometry
 * changes vs. the pre-pattern body.
 *
 * There is no UI dialog for linear pattern yet — the feature ships
 * kernel + adapter only. The test exercises the full parse →
 * executeTree → tessellate pipeline via the kernel RPC.
 */
test('linear pattern adds translated copies via kernel.addFeature', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // Seed a 50×50×50 body + a separate source sketch/extrude sitting beside
  // the body at (100, 0). The source uses `join` so its standalone output
  // (when re-executed by the pattern) is a separate 10×10×10 cube.
  await seedKernelPart(page, {
    parameters: [
      { name: 'd1', expression: '50', value: 50, unit: 'mm' },
      { name: 'd2', expression: '10', value: 10, unit: 'mm' },
    ],
    sketches: [
      { id: 'S1', primitives: [{ id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 50, h: 50 }] },
      { id: 'S2', primitives: [{ id: 'R2', kind: 'rectangle', x: 100, y: 0, w: 10, h: 10 }] },
    ],
    extrudes: [
      { id: 'E1', sketchRef: 'S1', distanceParam: 'd1', operation: 'new' },
      { id: 'E2', sketchRef: 'S2', distanceParam: 'd2', operation: 'join' },
    ],
  });

  const viewport = page.locator('[data-testid="viewport"]');
  await expect(viewport).toHaveAttribute('data-triangle-count', /[1-9]\d*/);
  const beforeHash = await viewport.getAttribute('data-geometry-hash');

  // Add the pattern feature directly via kernel RPC + sync store.
  await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          kernel: {
            addFeature(partId: string, feature: unknown): Promise<void>;
            setParameter(partId: string, p: unknown): Promise<void>;
            execute(partId: string): Promise<unknown>;
            getPart(partId: string): Promise<unknown>;
          };
          activePart: { id: string };
          setActivePart(p: unknown): void;
        };
      };
    };
    const s = w.__zilventorStore.getState();
    await s.kernel.setParameter(s.activePart.id, {
      name: 'pitch', expression: '40', value: 40, unit: 'mm',
    });
    await s.kernel.addFeature(s.activePart.id, {
      kind: 'pattern-linear',
      id: 'P1',
      sourceFeatureId: 'E2',
      direction: 'x',
      spacing: { kind: 'param', paramName: 'pitch' },
      count: 3,
    });
    await s.kernel.execute(s.activePart.id);
    const next = await s.kernel.getPart(s.activePart.id);
    s.setActivePart(next);
  });

  // Assert feature tree contains the pattern and viewport changed.
  const after = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          activePart: { featureTree: Array<{ kind: string; id: string }> } | null;
        };
      };
    };
    const part = w.__zilventorStore.getState().activePart!;
    const patterns = part.featureTree.filter((f) => f.kind === 'pattern-linear');
    return { patternCount: patterns.length, id: patterns[0]?.id };
  });
  expect(after.patternCount).toBe(1);
  expect(after.id).toBe('P1');

  await expect
    .poll(async () => viewport.getAttribute('data-geometry-hash'), {
      timeout: 5_000,
      message: 'expected geometry hash to change after pattern add',
    })
    .not.toBe(beforeHash);
});
