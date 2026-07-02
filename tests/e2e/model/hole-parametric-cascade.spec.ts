import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedKernelPart } from '../helpers/seedKernelPart';

/**
 * Hole parametric-cascade E2E test.
 *
 * Seeds a 20×20×10mm box + a from-sketch hole whose diameter references the
 * named parameter `d_hole = 4`. Mirrors r_fillet into the ParameterRegistry so
 * the F7 panel lists it. Then edits d_hole from 4 → 8 via the F7 Parameters
 * panel and asserts the viewport geometry hash changes — confirming the
 * parameter-change cascade reaches the hole feature recomputation path.
 *
 * Pattern mirrors fillet-parametric-cascade.spec.ts (T29).
 */
test('editing hole diameter parameter regenerates the hole', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // 1. Seed box body.
  await seedKernelPart(page, {
    parameters: [
      { name: 'd1',     expression: '10', value: 10, unit: 'mm' },
      { name: 'd_hole', expression: '4',  value: 4,  unit: 'mm' },
    ],
    sketches: [
      {
        id: 'S1',
        primitives: [{ id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 20, h: 20 }],
      },
    ],
    extrudes: [{ id: 'E1', sketchRef: 'S1', distanceParam: 'd1', operation: 'new' }],
  });

  // 2. Add circle sketch (S2) for hole placement.
  await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          kernel: { addFeature(partId: string, feature: unknown): Promise<void> };
          activePart: { id: string } | null;
          setActivePart(p: unknown): void;
        };
      };
    };
    const s = w.__zilventorStore.getState();
    await s.kernel.addFeature(s.activePart!.id, {
      kind: 'sketch',
      id: 'S2',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [{ id: 'C1', kind: 'circle', cx: 10, cy: 10, r: 1 }],
      constraints: [],
    });
  });

  // 3. Add the hole feature with diameter referencing d_hole.
  await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          kernel: {
            addFeature(partId: string, feature: unknown): Promise<void>;
            getPart(partId: string): Promise<unknown>;
          };
          activePart: { id: string } | null;
          setActivePart(p: unknown): void;
        };
      };
    };
    const s = w.__zilventorStore.getState();
    await s.kernel.addFeature(s.activePart!.id, {
      kind: 'hole',
      id: 'H1',
      placement: { kind: 'fromSketch', sketchId: 'S2' },
      profile: {
        kind: 'simple',
        diameter: { kind: 'param', paramName: 'd_hole' },
      },
      termination: { kind: 'throughAll' },
      flipAxis: false,
    });
    const next = await s.kernel.getPart(s.activePart!.id);
    s.setActivePart(next);
  });

  // 4. Mirror parameters into the ParameterRegistry so the F7 panel lists them.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorParameterRegistry: {
        setParameter(p: { name: string; expression: string; unit: string }): unknown;
      };
    };
    w.__zilventorParameterRegistry.setParameter({ name: 'd_hole', expression: '4',  unit: 'mm' });
    w.__zilventorParameterRegistry.setParameter({ name: 'd1',     expression: '10', unit: 'mm' });
  });

  const viewport = page.locator('[data-testid="viewport"]');
  await expect(viewport).toHaveAttribute('data-triangle-count', /[1-9]\d*/);
  await expect(viewport).toHaveAttribute('data-geometry-hash', /^[0-9a-f]+$/);
  const hashBefore = await viewport.getAttribute('data-geometry-hash');
  expect(hashBefore).toBeTruthy();

  // 5. Open Parameters panel via F7 and edit d_hole from 4 to 8.
  await page.keyboard.press('F7');
  await expect(page.getByRole('dialog', { name: /Parameters/i })).toBeVisible();
  await expect(page.locator('[data-testid="param-expression-d_hole"]')).toHaveText('4');

  await page.locator('[data-testid="param-expression-d_hole"]').dblclick();
  const input = page.locator('[data-testid="param-row-d_hole"] input');
  await input.fill('8');
  await input.press('Enter');

  // Registry recompute is synchronous.
  await expect(page.locator('[data-testid="param-value-d_hole"]')).toHaveText('8');

  // 6. The cascade must reach kernel → executeTree → viewport. A hole with
  //    diameter 8 mm vs 4 mm produces different geometry → hash changes.
  await expect
    .poll(async () => viewport.getAttribute('data-geometry-hash'), {
      timeout: 10_000,
      message: 'expected geometry hash to change after d_hole edit',
    })
    .not.toBe(hashBefore);

  const hashAfter = await viewport.getAttribute('data-geometry-hash');
  expect(hashAfter).toBeTruthy();
  expect(hashAfter).not.toBe(hashBefore);
});
