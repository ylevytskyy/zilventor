import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedKernelPart } from '../helpers/seedKernelPart';

/**
 * Chamfer smoke E2E.
 *
 * Seeds a cube, opens the Chamfer dialog via the `k` shortcut, seeds an
 * edge onto the store's `chamferEdges`, sets Distance to 2, clicks OK,
 * and asserts the feature tree now contains a chamfer feature.
 *
 * Rather than drive interactive 3D pick (already covered by the fillet
 * E2E), the test seeds `chamferEdges` via the store — exercising the
 * commit + adapter + kernel path end to end.
 */
test('chamfer commits a feature and updates the viewport geometry', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  await seedKernelPart(page, {
    parameters: [
      { name: 'd1', expression: '10', value: 10, unit: 'mm' },
    ],
    sketches: [
      {
        id: 'S1',
        primitives: [{ id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 10, h: 10 }],
      },
    ],
    extrudes: [{ id: 'E1', sketchRef: 'S1', distanceParam: 'd1', operation: 'new' }],
  });

  const viewport = page.locator('[data-testid="viewport"]');
  await expect(viewport).toHaveAttribute('data-triangle-count', /[1-9]\d*/);
  const beforeHash = await viewport.getAttribute('data-geometry-hash');

  // Open Chamfer dialog via K shortcut.
  await page.keyboard.press('k');
  const dialog = page.getByRole('dialog', { name: /Chamfer/i });
  await expect(dialog).toBeVisible();

  // Seed chamferEdges directly on the store so we can exercise commit
  // without needing the interactive ray pick (covered by fillet E2E).
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): { setChamferEdges(edges: Array<unknown>): void };
      };
    };
    w.__zilventorStore.getState().setChamferEdges([
      {
        edgeId: {
          faceA: { featureId: 'E1', role: 'top', instance: 0 },
          faceB: { featureId: 'E1', role: 'side', instance: 0 },
        },
        selectionMode: 'edge',
        distance: { kind: 'param', paramName: 'd_chamfer' },
      },
    ]);
  });

  // Set distance and commit.
  await dialog.getByLabel('Distance').fill('2');
  await dialog.getByRole('button', { name: 'OK' }).click();

  await expect(dialog).not.toBeVisible();

  // Feature tree now contains a chamfer, and geometry changed from
  // the pre-chamfer cube.
  const after = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          activePart: {
            featureTree: Array<{ kind: string; id: string }>;
            parameters: Record<string, { expression: string }>;
          } | null;
        };
      };
    };
    const part = w.__zilventorStore.getState().activePart!;
    const chamfers = part.featureTree.filter((f) => f.kind === 'chamfer');
    return {
      chamferCount: chamfers.length,
      distance: part.parameters['d_chamfer']?.expression,
    };
  });
  expect(after.chamferCount).toBe(1);
  expect(after.distance).toBe('2');

  await expect
    .poll(async () => viewport.getAttribute('data-geometry-hash'), {
      timeout: 5_000,
      message: 'expected geometry to change after chamfer',
    })
    .not.toBe(beforeHash);
});
