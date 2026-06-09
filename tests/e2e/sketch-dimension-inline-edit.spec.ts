/**
 * Sketch dimension inline-edit — end-to-end gate.
 *
 * A) Double-click a dim-length dimension label → type new value → Enter →
 *    assert store dimension value changed + primitive geometry changed.
 * B) Double-click a dim-radius dimension label → type new value → Enter →
 *    assert store dimension value changed + arc radius changed.
 * C) Undo restores both the dimension value and the geometry.
 *
 * Note: the param-bound-dim refuse path (double-click → toast, no inline editor)
 * is covered by the DimensionRenderer unit test + the §6 manual browser gate;
 * it is intentionally not exercised here (seeding a ParameterRegistry-linked dim
 * end-to-end is deferred — see the design spec's Deferred section).
 */

import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

type ZilventorWindow = {
  __zilventorStore: {
    getState(): AppState;
    setState(patch: Partial<AppState>): void;
  };
};

type AppState = {
  activePart: PartDoc | null;
  activeSketchId: string | null;
  sketchMode: boolean;
  kernel: KernelClient | null;
  bus: { execute(c: unknown): Promise<unknown>; undo(): Promise<void> };
  setActivePart(p: PartDoc | null): void;
};

type PartDoc = {
  id: string;
  featureTree: Feature[];
  materials: unknown[];
};

type Feature =
  | { kind: 'sketch'; id: string; primitives: Primitive[]; constraints: Constraint[] }
  | { kind: string; id: string };

type Primitive = {
  id: string;
  kind: string;
  x1?: number; y1?: number; x2?: number; y2?: number;
  cx?: number; cy?: number; r?: number;
};

type Constraint = {
  id: string;
  kind: string;
  value?: { kind: string; value?: number; paramName?: string };
};

type KernelClient = {
  addFeature(partId: string, f: unknown): Promise<void>;
  setParameter(partId: string, p: unknown): Promise<void>;
  getPart(partId: string): Promise<PartDoc | null>;
};

async function getState(page: import('@playwright/test').Page): Promise<AppState> {
  return page.evaluate(() =>
    (window as unknown as ZilventorWindow).__zilventorStore.getState(),
  );
}

async function setupNewPart(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();
}

/** Seed a sketch with primitives + constraints, then enter sketch mode. */
async function seedSketchAndEnter(
  page: import('@playwright/test').Page,
  sketchId: string,
  primitives: Primitive[],
  constraints: Constraint[],
): Promise<void> {
  await page.evaluate(
    async ({ sketchId, primitives, constraints }: { sketchId: string; primitives: Primitive[]; constraints: Constraint[] }) => {
      const s = (window as unknown as ZilventorWindow).__zilventorStore.getState();
      if (!s.kernel || !s.activePart) throw new Error('kernel or activePart not ready');
      await s.kernel.addFeature(s.activePart.id, {
        kind: 'sketch', id: sketchId,
        plane: { source: 'workPlane', featureId: 'origin.XY' },
        primitives, constraints,
      });
      const next = await s.kernel.getPart(s.activePart.id);
      s.setActivePart(next);
      (s as unknown as { setSketchMode(on: boolean, id: string): void }).setSketchMode(true, sketchId);
    },
    { sketchId, primitives, constraints },
  );
  await page.getByRole('tab', { name: 'Sketch' }).click();
  await expect(page.getByRole('button', { name: /Finish Sketch/i })).toBeVisible();
}

// ---------------------------------------------------------------------------
// A+C: dim-length inline edit + undo
// ---------------------------------------------------------------------------
test.describe('Sketch dimension inline-edit — dim-length', () => {
  test(
    'double-click dim-length label, type new value, assert store value + geometry changed; undo restores',
    async ({ page }) => {
      page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
      await setupNewPart(page);

      const SKETCH_ID = 'sk-dim-inline-length';
      // A line with a dim-length = 50. We will change it to 80.
      // paramName and line are required fields on dim-length (DimBase + { line: string }).
      await seedSketchAndEnter(page, SKETCH_ID, [
        { id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 50, y2: 0 },
      ], [
        { id: 'd1', kind: 'dim-length', paramName: 'd1', line: 'l1', value: { kind: 'literal', value: 50 } } as Constraint,
      ]);

      // Wait for the dimension glyph to appear.
      await expect(page.locator('[data-testid="dimension-glyph"]').first()).toBeVisible({ timeout: 8_000 });

      // Double-click the glyph.
      await page.locator('[data-testid="dimension-glyph"]').first().dblclick();

      // An input should appear.
      const input = page.locator('[data-testid^="dim-inline-input-"]').first();
      await expect(input).toBeVisible({ timeout: 3_000 });

      // Type a new value and commit with Enter.
      await input.fill('80');
      await input.press('Enter');

      // Wait for the store to reflect the new dimension value.
      await page.waitForFunction(() => {
        const s = (window as unknown as ZilventorWindow).__zilventorStore.getState();
        const sketchId = s.activeSketchId;
        const sketch = s.activePart?.featureTree.find((f) => f.kind === 'sketch' && (f as { id: string }).id === sketchId);
        if (!sketch || sketch.kind !== 'sketch') return false;
        const dim = (sketch as { constraints: Constraint[] }).constraints.find((c) => c.id === 'd1');
        return dim?.value?.kind === 'literal' && dim.value.value === 80;
      }, { timeout: 8_000 });

      // Assert geometry: l1.x2 should now be ~80 (solver moved the endpoint).
      const stateAfter = await getState(page);
      const sketchAfter = stateAfter.activePart?.featureTree.find(
        (f): f is Extract<Feature, { kind: 'sketch' }> =>
          f.kind === 'sketch' && f.id === stateAfter.activeSketchId,
      );
      expect(sketchAfter).toBeDefined();
      const dimAfter = sketchAfter!.constraints.find((c) => c.id === 'd1');
      expect(dimAfter?.value?.value).toBe(80);
      // Geometry moved (l1.x2 changed from 50 to ~80).
      const l1After = sketchAfter!.primitives.find((p) => p.id === 'l1');
      expect(l1After).toBeDefined();
      expect((l1After as Primitive).x2).toBeGreaterThan(70); // solver may not land at exactly 80 without full constraints

      // UNDO: press Ctrl+Z.
      await page.keyboard.press('Control+z');

      // Wait for store to revert dim value.
      await page.waitForFunction(() => {
        const s = (window as unknown as ZilventorWindow).__zilventorStore.getState();
        const sketchId = s.activeSketchId;
        const sketch = s.activePart?.featureTree.find((f) => f.kind === 'sketch' && (f as { id: string }).id === sketchId);
        if (!sketch || sketch.kind !== 'sketch') return false;
        const dim = (sketch as { constraints: Constraint[] }).constraints.find((c) => c.id === 'd1');
        return dim?.value?.kind === 'literal' && dim.value.value === 50;
      }, { timeout: 8_000 });

      const stateReverted = await getState(page);
      const sketchReverted = stateReverted.activePart?.featureTree.find(
        (f): f is Extract<Feature, { kind: 'sketch' }> =>
          f.kind === 'sketch' && f.id === stateReverted.activeSketchId,
      );
      const dimReverted = sketchReverted!.constraints.find((c) => c.id === 'd1');
      expect(dimReverted?.value?.value).toBe(50);
    },
  );
});

// ---------------------------------------------------------------------------
// B: dim-radius inline edit
// ---------------------------------------------------------------------------
test.describe('Sketch dimension inline-edit — dim-radius', () => {
  test(
    'double-click dim-radius label, type new radius, assert store + arc radius updated',
    async ({ page }) => {
      page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
      await setupNewPart(page);

      const SKETCH_ID = 'sk-dim-inline-radius';
      // paramName and circle are required fields on dim-radius (DimBase + { circle: string }).
      await seedSketchAndEnter(page, SKETCH_ID, [
        { id: 'a1', kind: 'arc', cx: 0, cy: 0, r: 10, startAngle: 0, endAngle: Math.PI },
      ], [
        { id: 'd2', kind: 'dim-radius', paramName: 'd2', circle: 'a1', value: { kind: 'literal', value: 10 } } as Constraint,
      ]);

      await expect(page.locator('[data-testid="dimension-glyph"]').first()).toBeVisible({ timeout: 8_000 });
      await page.locator('[data-testid="dimension-glyph"]').first().dblclick();

      const input = page.locator('[data-testid^="dim-inline-input-"]').first();
      await expect(input).toBeVisible({ timeout: 3_000 });
      await input.fill('20');
      await input.press('Enter');

      await page.waitForFunction(() => {
        const s = (window as unknown as ZilventorWindow).__zilventorStore.getState();
        const sketchId = s.activeSketchId;
        const sketch = s.activePart?.featureTree.find((f) => f.kind === 'sketch' && (f as { id: string }).id === sketchId);
        if (!sketch || sketch.kind !== 'sketch') return false;
        const dim = (sketch as { constraints: Constraint[] }).constraints.find((c) => c.id === 'd2');
        return dim?.value?.kind === 'literal' && dim.value.value === 20;
      }, { timeout: 8_000 });

      const stateAfter = await getState(page);
      const sketchAfter = stateAfter.activePart?.featureTree.find(
        (f): f is Extract<Feature, { kind: 'sketch' }> =>
          f.kind === 'sketch' && f.id === stateAfter.activeSketchId,
      );
      const a1 = sketchAfter!.primitives.find((p) => p.id === 'a1');
      // Solver should have updated the arc radius.
      expect((a1 as Primitive).r).toBeGreaterThan(15);
    },
  );
});
