import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('inferred constraints from legacy parts render as badges', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);

  // Set up a part with 2 lines and 2 inferred-migration constraints directly in the store
  // (simulating what v2→v3 migration would produce).
  await page.evaluate(() => {
    const w = window as unknown as { __zilventorStore?: { getState(): Record<string, unknown> } };
    if (!w.__zilventorStore) throw new Error('store not exposed');
    const s = w.__zilventorStore.getState() as Record<string, unknown> & {
      setActivePart(p: unknown): void;
      setSketchMode(mode: boolean, sketchId?: string | null): void;
    };
    s.setActivePart({
      id: 'P1', name: 'Part1', units: 'mm', parameters: {},
      featureTree: [{
        kind: 'sketch',
        id: 'S1',
        plane: 'XY',
        primitives: [
          { id: 'L1', kind: 'line', x1: -50, y1: 0, x2: 50, y2: 0 },
          { id: 'L2', kind: 'line', x1: 0, y1: -30, x2: 0, y2: 30 }
        ],
        constraints: [
          { id: 'c-inf-h-L1', kind: 'horizontal', line: 'L1', source: 'inferred-migration' },
          { id: 'c-inf-v-L2', kind: 'vertical', line: 'L2', source: 'inferred-migration' }
        ]
      }]
    });
    s.setSketchMode(true, 'S1');
  });

  // 2 badges must render
  await expect(page.locator('[data-testid="constraint-badge"]')).toHaveCount(2, { timeout: 3000 });

  // Footer shows some DOF state (it won't match without sketcherClient.loadSketch being called;
  // but since __zilventorStore.setActivePart doesn't go through enter(), the DOF segment
  // may be null — that's fine, the badge render is the primary assertion).
});
