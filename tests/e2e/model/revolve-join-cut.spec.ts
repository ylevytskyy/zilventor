import { test, expect, type Page } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * T17 — revolve Join + Cut against an existing body.
 *
 * Strategy (state-seeded, mirroring T16):
 *   1. Create a Part via UI so the kernel has it.
 *   2. Seed a base extrude via kernel.addFeature (rect sketch + extrude 'new').
 *      After this, hasRunningBody = true so Join/Cut are enabled.
 *   3. Seed a second sketch (rect + axis line). Press R, pick axis, fill
 *      angle, click Join, OK. Revolve #1 joins with the base body.
 *   4. Seed a third sketch (rect + axis line). Press R, pick axis, fill
 *      angle, click Cut, OK. Revolve #2 cuts a slice out of the body.
 *   5. Assert the feature tree has 3 solid features (1 extrude + 2 revolves)
 *      and the viewport meshed (triangle count > 0).
 *
 * Coordinate layout (world units, mm):
 *   Base extrude rectangle:   (0,0)-(40,40)         — the cube profile.
 *   Extrude depth:            d_base = 20mm         — extrude parameter.
 *
 *   Revolve #1 (Join) sketch:
 *     Rect:  (45,0)-(60,20)                         — to the right of the cube.
 *     Axis:  (45,0)-(45,20)                         — along rect's left edge.
 *   Revolve #2 (Cut) sketch:
 *     Rect:  (5,5)-(15,15)                          — inside the cube footprint.
 *     Axis:  (5,5)-(5,15)                           — along rect's left edge.
 */

type SketchSeed = {
  sketchId: string;
  rectId: string;
  rect: { x: number; y: number; w: number; h: number };
  axisId: string;
  axis: { x1: number; y1: number; x2: number; y2: number };
};

async function seedSketch(page: Page, seed: SketchSeed): Promise<void> {
  await page.evaluate(async (s) => {
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
    const state = w.__zilventorStore.getState();
    if (!state.kernel || !state.activePart) throw new Error('store not primed');
    const sketch = {
      kind: 'sketch',
      id: s.sketchId,
      plane: 'XY',
      primitives: [
        { id: s.rectId, kind: 'rectangle', x: s.rect.x, y: s.rect.y, w: s.rect.w, h: s.rect.h },
        { id: s.axisId, kind: 'line', x1: s.axis.x1, y1: s.axis.y1, x2: s.axis.x2, y2: s.axis.y2 },
      ],
      constraints: [],
    };
    await state.kernel.addFeature(state.activePart.id, sketch);
    const next = await state.kernel.getPart(state.activePart.id);
    state.setActivePart(next);
  }, seed);
}

async function seedBaseExtrude(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          kernel: {
            addFeature(partId: string, feature: unknown): Promise<void>;
            setParameter(partId: string, p: unknown): Promise<void>;
            getPart(partId: string): Promise<unknown>;
          };
          activePart: { id: string } | null;
          setActivePart(p: unknown): void;
        };
      };
    };
    const state = w.__zilventorStore.getState();
    if (!state.kernel || !state.activePart) throw new Error('store not primed');
    // Base sketch: plain 40x40 rectangle; no axis — extrude doesn't need one.
    const sketch = {
      kind: 'sketch',
      id: 'S_base',
      plane: 'XY',
      primitives: [
        { id: 'P_base_rect', kind: 'rectangle', x: 0, y: 0, w: 40, h: 40 },
      ],
      constraints: [],
    };
    await state.kernel.addFeature(state.activePart.id, sketch);
    await state.kernel.setParameter(state.activePart.id, {
      name: 'd_base', expression: '20', value: 20, unit: 'mm',
    });
    const extrude = {
      kind: 'extrude',
      id: 'E_base',
      sketchRef: 'S_base',
      distanceParam: 'd_base',
      direction: 'forward',
      operation: 'new',
    };
    await state.kernel.addFeature(state.activePart.id, extrude);
    const next = await state.kernel.getPart(state.activePart.id);
    state.setActivePart(next);
  });
}

async function clickAxisInViewport(
  page: Page,
  axis: { x1: number; y1: number; x2: number; y2: number }
): Promise<void> {
  const midX = (axis.x1 + axis.x2) / 2;
  const midY = (axis.y1 + axis.y2) / 2;
  const axisCanvasPt = await page.evaluate(
    ({ x, y }) => {
      const w = window as unknown as {
        __zilventorWorldToScreen: (wx: number, wy: number) => { x: number; y: number };
      };
      return w.__zilventorWorldToScreen(x, y);
    },
    { x: midX, y: midY }
  );
  const viewport = page.locator('main#region-viewport canvas');
  await viewport.click({
    position: { x: axisCanvasPt.x, y: axisCanvasPt.y },
    force: true,
  });
}

test('revolve Join then Cut against existing body', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Create a part via UI.
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // 2. Seed a base extrude so hasRunningBody is true.
  await seedBaseExtrude(page);

  // Triangle count should be positive after the base extrude.
  await expect(page.locator('[data-triangle-count]')).toHaveAttribute(
    'data-triangle-count',
    /[1-9]\d*/
  );

  // 3. Seed a separate sketch for the Join revolve.
  const joinSeed: SketchSeed = {
    sketchId: 'S_join',
    rectId: 'P_join_rect',
    rect: { x: 45, y: 0, w: 15, h: 20 },
    axisId: 'P_join_axis',
    axis: { x1: 45, y1: 0, x2: 45, y2: 20 },
  };
  await seedSketch(page, joinSeed);

  // 4. Open the Revolve dialog and commit a Join revolve.
  await page.keyboard.press('r');
  const dialog1 = page.getByRole('dialog', { name: /Revolve/i });
  await expect(dialog1).toBeVisible();
  // Profile auto-picks the last sketch (S_join).
  await expect(dialog1.getByText(/S_join/)).toBeVisible();

  await dialog1.getByRole('button', { name: /^Pick$/ }).click();
  await clickAxisInViewport(page, joinSeed.axis);
  await expect(dialog1.getByText(/P_join_axis/)).toBeVisible();

  await dialog1.getByLabel('Angle').fill('360');
  // hasRunningBody was true when dialog opened → default is Join. Click to be
  // explicit and guard against future default changes.
  await dialog1.getByRole('button', { name: /^Join$/ }).click();
  await dialog1.getByRole('button', { name: /^OK$/ }).click();
  await expect(dialog1).not.toBeVisible();

  // Verify 2 solid features after the Join revolve.
  const countAfterJoin = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): { activePart: { featureTree: Array<{ kind: string }> } | null };
      };
    };
    const s = w.__zilventorStore.getState();
    return (
      s.activePart?.featureTree.filter(
        (f) => f.kind === 'extrude' || f.kind === 'revolve'
      ).length ?? 0
    );
  });
  expect(countAfterJoin).toBe(2);

  await expect(page.locator('[data-triangle-count]')).toHaveAttribute(
    'data-triangle-count',
    /[1-9]\d*/
  );

  // 5. Seed a third sketch for the Cut revolve.
  const cutSeed: SketchSeed = {
    sketchId: 'S_cut',
    rectId: 'P_cut_rect',
    rect: { x: 5, y: 5, w: 10, h: 10 },
    axisId: 'P_cut_axis',
    axis: { x1: 5, y1: 5, x2: 5, y2: 15 },
  };
  await seedSketch(page, cutSeed);

  // 6. Open Revolve dialog again and commit a Cut revolve.
  await page.keyboard.press('r');
  const dialog2 = page.getByRole('dialog', { name: /Revolve/i });
  await expect(dialog2).toBeVisible();
  await expect(dialog2.getByText(/S_cut/)).toBeVisible();

  await dialog2.getByRole('button', { name: /^Pick$/ }).click();
  await clickAxisInViewport(page, cutSeed.axis);
  await expect(dialog2.getByText(/P_cut_axis/)).toBeVisible();

  // Default is Join (hasRunningBody still true) — explicitly switch to Cut.
  await dialog2.getByLabel('Angle').fill('360');
  await dialog2.getByRole('button', { name: /^Cut$/ }).click();
  await dialog2.getByRole('button', { name: /^OK$/ }).click();
  await expect(dialog2).not.toBeVisible();

  // 7. Final assertions: 3 solid features (extrude + join revolve + cut revolve).
  const countAfterCut = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): { activePart: { featureTree: Array<{ kind: string }> } | null };
      };
    };
    const s = w.__zilventorStore.getState();
    return (
      s.activePart?.featureTree.filter(
        (f) => f.kind === 'extrude' || f.kind === 'revolve'
      ).length ?? 0
    );
  });
  expect(countAfterCut).toBe(3);

  // Specifically verify we have 1 extrude + 2 revolves.
  const kinds = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): { activePart: { featureTree: Array<{ kind: string }> } | null };
      };
    };
    const s = w.__zilventorStore.getState();
    return s.activePart?.featureTree.map((f) => f.kind) ?? [];
  });
  expect(kinds.filter((k) => k === 'extrude').length).toBe(1);
  expect(kinds.filter((k) => k === 'revolve').length).toBe(2);

  await expect(page.locator('[data-triangle-count]')).toHaveAttribute(
    'data-triangle-count',
    /[1-9]\d*/
  );
});
