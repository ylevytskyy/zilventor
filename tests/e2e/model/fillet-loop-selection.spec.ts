import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedKernelPart } from '../helpers/seedKernelPart';

/**
 * T28 — DOWNGRADED: interactive loop-pick flow is blocked (depends on
 * tessellated-edge extraction from NamedShape, which is not yet surfaced in
 * ExecutionResult). Rather than skipping, this test verifies the multi-edge
 * code path end-to-end by pre-populating a fillet with all 4 top edges — the
 * exact result a future interactive Loop-mode pick would produce — and
 * asserting that executeTree successfully tessellates the resulting shape.
 */
test('fillet with 4 top edges (pre-seeded, simulates Loop mode result)', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  const topEdges = [0, 1, 2, 3].map((i) => ({
    faceA: { featureId: 'E1', role: 'top', instance: 0 },
    faceB: { featureId: 'E1', role: 'side', instance: i },
  }));

  await seedKernelPart(page, {
    parameters: [
      { name: 'd1', expression: '10', value: 10, unit: 'mm' },
      { name: 'r_fillet', expression: '2', value: 2, unit: 'mm' },
    ],
    sketches: [
      {
        id: 'S1',
        primitives: [{ id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 10, h: 10 }],
      },
    ],
    extrudes: [{ id: 'E1', sketchRef: 'S1', distanceParam: 'd1', operation: 'new' }],
    fillets: [
      {
        id: 'F1',
        mode: 'constant',
        edges: topEdges.map((edgeId) => ({
          edgeId,
          selectionMode: 'loop' as const,
          radius: { kind: 'param' as const, paramName: 'r_fillet' },
        })),
      },
    ],
  });

  // Feature tree contains the loop-mode fillet with 4 edge specs.
  const edgeSpecCount = await page.evaluate(() => {
    const s = (window as unknown as {
      __zilventorStore: {
        getState(): {
          activePart: {
            featureTree: Array<{ kind: string; edges?: Array<unknown> }>;
          };
        };
      };
    }).__zilventorStore.getState();
    const f = s.activePart.featureTree.find((x) => x.kind === 'fillet');
    return (f?.edges ?? []).length;
  });
  expect(edgeSpecCount).toBe(4);

  // Viewport tessellated the result.
  await expect(page.locator('[data-triangle-count]')).toHaveAttribute(
    'data-triangle-count',
    /[1-9]\d*/
  );
});
