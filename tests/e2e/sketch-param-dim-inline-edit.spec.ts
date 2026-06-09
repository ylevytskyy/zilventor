/**
 * Sketch param-dim inline edit — end-to-end gate.
 *
 * A) Double-click a param-bound dim → editor seeded with the parameter's expression
 *    → type new expression → assert registry value updated + geometry moved.
 * B) Literal dim: type "100/2" → evaluates to 50 (arithmetic literal).
 * C) Literal dim: type a param-ref "myWidth" → editor stays open (rejected).
 * D) Undo after param-dim edit restores the expression + geometry.
 *
 * Note on seeding order (param-dim):
 *   1. kernel.addFeature → adds sketch with param-bound constraint to the kernel
 *   2. kernel.getPart + setActivePart → loads sketch into store
 *   3. window.__zilventorParameterRegistry.setParameter(…) → seeds param in registry
 *      (fires subscribe → store.setParameterInStore → activePart.parameters updated)
 *   4. setSketchMode(true, sketchId) → enters sketch mode (worker initializes WASM)
 *
 *   Do NOT use kernel.setParameter + setActivePart(same-id) for seeding —
 *   the registry-rebuild effect (App.tsx:1291) is keyed on [activePart?.id] and
 *   won't re-fire for the same id, so parameterRegistry stays empty and
 *   handleDimEditCommit can't find the param.
 */

import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

type ZilventorWindow = {
  __zilventorStore: {
    getState(): AppState;
    setState(patch: Partial<AppState>): void;
  };
  __zilventorParameterRegistry: {
    getValue(name: string): number | undefined;
    getAll(): Array<{ name: string; expression: string; value: number; unit: string }>;
    setParameter(input: { name: string; expression: string; unit: string }): { ok: boolean };
  };
};

type AppState = {
  activePart: PartDoc | null;
  activeSketchId: string | null;
  sketchMode: boolean;
  kernel: KernelClient | null;
  sketchDof: number | null;
  bus: { execute(c: unknown): Promise<unknown>; undo(): Promise<void> };
  setActivePart(p: PartDoc | null): void;
};

type PartDoc = {
  id: string;
  featureTree: Feature[];
  parameters?: Record<string, { name: string; expression: string; value: number; unit: string }>;
  materials: unknown[];
};

type Feature =
  | { kind: 'sketch'; id: string; primitives: Primitive[]; constraints: Constraint[] }
  | { kind: string; id: string };

type Primitive = {
  id: string; kind: string;
  x1?: number; y1?: number; x2?: number; y2?: number;
  cx?: number; cy?: number; r?: number;
};

type Constraint = {
  id: string; kind: string; line?: string; circle?: string;
  value?: { kind: string; value?: number; paramName?: string };
};

type KernelClient = {
  addFeature(partId: string, f: unknown): Promise<void>;
  setParameter(partId: string, p: unknown): Promise<void>;
  getPart(partId: string): Promise<PartDoc | null>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setupNewPart(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();
}

/** Seed a literal-dim sketch and enter sketch mode. */
async function seedLiteralSketchAndEnter(
  page: import('@playwright/test').Page,
  sketchId: string,
  primitives: Primitive[],
  constraints: Constraint[],
): Promise<void> {
  await page.evaluate(
    async ({
      sketchId,
      primitives,
      constraints,
    }: {
      sketchId: string;
      primitives: Primitive[];
      constraints: Constraint[];
    }) => {
      const s = (window as unknown as ZilventorWindow).__zilventorStore.getState();
      if (!s.kernel || !s.activePart) throw new Error('kernel or activePart not ready');
      await s.kernel.addFeature(s.activePart.id, {
        kind: 'sketch',
        id: sketchId,
        plane: { source: 'workPlane', featureId: 'origin.XY' },
        primitives,
        constraints,
      });
      const next = await s.kernel.getPart(s.activePart.id);
      s.setActivePart(next);
      (
        s as unknown as { setSketchMode(on: boolean, id: string): void }
      ).setSketchMode(true, sketchId);
    },
    { sketchId, primitives, constraints },
  );
  await page.getByRole('tab', { name: 'Sketch' }).click();
  await expect(page.getByRole('button', { name: /Finish Sketch/i })).toBeVisible();
}

/**
 * Seed a param-bound sketch and enter sketch mode.
 * Order: addFeature → getPart → setActivePart → setParameter (seeds registry) → setSketchMode.
 */
async function seedParamSketchAndEnter(
  page: import('@playwright/test').Page,
  sketchId: string,
  paramName: string,
  paramExpr: string,
): Promise<void> {
  await page.evaluate(
    async ({
      sketchId,
      paramName,
      paramExpr,
    }: {
      sketchId: string;
      paramName: string;
      paramExpr: string;
    }) => {
      const w = window as unknown as ZilventorWindow;
      const s = w.__zilventorStore.getState();
      if (!s.kernel || !s.activePart) throw new Error('kernel or activePart not ready');

      // 1. Add sketch with a line and a param-bound dim constraint.
      await s.kernel.addFeature(s.activePart.id, {
        kind: 'sketch',
        id: sketchId,
        plane: { source: 'workPlane', featureId: 'origin.XY' },
        primitives: [{ id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 50, y2: 0 }],
        constraints: [
          {
            id: 'd1',
            kind: 'dim-length',
            paramName: 'd1',
            line: 'l1',
            value: { kind: 'param', paramName },
          },
        ],
      });

      // 2. Load the updated part into the store.
      const next = await s.kernel.getPart(s.activePart.id);
      s.setActivePart(next);

      // 3. Seed the parameter via the live registry singleton (same as ParametersPanel does).
      //    This fires subscribe → store.setParameterInStore → activePart.parameters updated.
      const regResult = w.__zilventorParameterRegistry.setParameter({
        name: paramName,
        expression: paramExpr,
        unit: 'mm',
      });
      if (!regResult.ok) throw new Error(`registry.setParameter failed for '${paramName}'`);

      // 4. Enter sketch mode (triggers WASM worker initialization).
      (
        s as unknown as { setSketchMode(on: boolean, id: string): void }
      ).setSketchMode(true, sketchId);
    },
    { sketchId, paramName, paramExpr },
  );
  await page.getByRole('tab', { name: 'Sketch' }).click();
  await expect(page.getByRole('button', { name: /Finish Sketch/i })).toBeVisible();
}

// ---------------------------------------------------------------------------
// Test A: param-dim edit — expression edit + geometry moves
// ---------------------------------------------------------------------------
test.describe('Sketch param-dim inline edit — Test A', () => {
  test(
    'double-click param-bound dim → type new expression → registry value + geometry updated',
    async ({ page }) => {
      page.on('pageerror', (e) => console.error('PAGEERROR:', e.message));
      await setupNewPart(page);
      await seedParamSketchAndEnter(page, 'sk-param-a', 'myWidth', '50');

      // Wait for the dimension glyph to appear (proves sketcher worker loaded).
      await expect(page.locator('[data-testid="dimension-glyph"]').first()).toBeVisible({
        timeout: 8_000,
      });

      // Double-click the glyph.
      await page.locator('[data-testid="dimension-glyph"]').first().dblclick();

      // An input should appear.
      const input = page.locator('[data-testid^="dim-inline-input-"]').first();
      await expect(input).toBeVisible({ timeout: 3_000 });

      // The editor should be seeded with the parameter's expression '50'.
      await expect(input).toHaveValue('50');

      // Type the new expression and commit.
      await input.fill('80');
      await input.press('Enter');

      // Registry value should update to 80.
      await page.waitForFunction(
        () =>
          (window as unknown as ZilventorWindow).__zilventorParameterRegistry.getValue(
            'myWidth',
          ) === 80,
        { timeout: 8_000 },
      );

      // Geometry moved: l1.x2 should be > 70 (solver moved the endpoint to ~80).
      await page.waitForFunction(
        () => {
          const s = (window as unknown as ZilventorWindow).__zilventorStore.getState();
          const sketchId = s.activeSketchId;
          const sketch = s.activePart?.featureTree.find(
            (f) => f.kind === 'sketch' && (f as { id: string }).id === sketchId,
          );
          if (!sketch || sketch.kind !== 'sketch') return false;
          const l1 = (sketch as { primitives: Primitive[] }).primitives.find(
            (p) => p.id === 'l1',
          );
          return (l1?.x2 ?? 0) > 70;
        },
        { timeout: 8_000 },
      );
    },
  );
});

// ---------------------------------------------------------------------------
// Test B: arithmetic literal — "100/2" → 50
// ---------------------------------------------------------------------------
test.describe('Sketch literal dim arithmetic — Test B', () => {
  test('type 100/2 for a literal dim evaluates to 50', async ({ page }) => {
    page.on('pageerror', (e) => console.error('PAGEERROR:', e.message));
    await setupNewPart(page);

    await seedLiteralSketchAndEnter(
      page,
      'sk-arith-b',
      [{ id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 60, y2: 0 }],
      [
        {
          id: 'd1',
          kind: 'dim-length',
          paramName: 'd1',
          line: 'l1',
          value: { kind: 'literal', value: 60 },
        } as Constraint,
      ],
    );

    await expect(page.locator('[data-testid="dimension-glyph"]').first()).toBeVisible({
      timeout: 8_000,
    });
    await page.locator('[data-testid="dimension-glyph"]').first().dblclick();

    const input = page.locator('[data-testid^="dim-inline-input-"]').first();
    await expect(input).toBeVisible({ timeout: 3_000 });
    await input.fill('100/2');
    await input.press('Enter');

    // Wait for the store dimension value to become 50.
    await page.waitForFunction(
      () => {
        const s = (window as unknown as ZilventorWindow).__zilventorStore.getState();
        const sketchId = s.activeSketchId;
        const sketch = s.activePart?.featureTree.find(
          (f) => f.kind === 'sketch' && (f as { id: string }).id === sketchId,
        );
        if (!sketch || sketch.kind !== 'sketch') return false;
        const dim = (sketch as { constraints: Constraint[] }).constraints.find(
          (c) => c.id === 'd1',
        );
        return dim?.value?.kind === 'literal' && dim.value.value === 50;
      },
      { timeout: 8_000 },
    );
  });
});

// ---------------------------------------------------------------------------
// Test C: param-ref rejected for literal dim — editor stays open
// ---------------------------------------------------------------------------
test.describe('Sketch literal dim param-ref rejection — Test C', () => {
  test('typing a param-ref into a literal dim keeps the editor open', async ({ page }) => {
    page.on('pageerror', (e) => console.error('PAGEERROR:', e.message));
    await setupNewPart(page);

    await seedLiteralSketchAndEnter(
      page,
      'sk-paramref-c',
      [{ id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 60, y2: 0 }],
      [
        {
          id: 'd1',
          kind: 'dim-length',
          paramName: 'd1',
          line: 'l1',
          value: { kind: 'literal', value: 60 },
        } as Constraint,
      ],
    );

    await expect(page.locator('[data-testid="dimension-glyph"]').first()).toBeVisible({
      timeout: 8_000,
    });
    await page.locator('[data-testid="dimension-glyph"]').first().dblclick();

    const input = page.locator('[data-testid^="dim-inline-input-"]').first();
    await expect(input).toBeVisible({ timeout: 3_000 });

    // Type a param-ref (identifier) — should be rejected.
    await input.fill('myWidth');
    await input.press('Enter');

    // Editor must still be visible after rejection.
    await expect(input).toBeVisible({ timeout: 2_000 });

    // Store dim value should remain unchanged at 60.
    const stateAfter = await page.evaluate(() =>
      (window as unknown as ZilventorWindow).__zilventorStore.getState(),
    );
    const sketchAfter = stateAfter.activePart?.featureTree.find(
      (f): f is Extract<Feature, { kind: 'sketch' }> =>
        f.kind === 'sketch' && f.id === stateAfter.activeSketchId,
    );
    const dimAfter = sketchAfter?.constraints.find((c) => c.id === 'd1');
    expect(dimAfter?.value?.value).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// Test D: undo restores param expression + geometry
// ---------------------------------------------------------------------------
test.describe('Sketch param-dim undo — Test D', () => {
  test('undo after param-dim edit restores expression and geometry', async ({ page }) => {
    page.on('pageerror', (e) => console.error('PAGEERROR:', e.message));
    await setupNewPart(page);
    await seedParamSketchAndEnter(page, 'sk-param-d', 'myWidth', '50');

    await expect(page.locator('[data-testid="dimension-glyph"]').first()).toBeVisible({
      timeout: 8_000,
    });
    await page.locator('[data-testid="dimension-glyph"]').first().dblclick();

    const input = page.locator('[data-testid^="dim-inline-input-"]').first();
    await expect(input).toBeVisible({ timeout: 3_000 });
    await input.fill('80');
    await input.press('Enter');

    // Wait for registry to reflect the edit.
    await page.waitForFunction(
      () =>
        (window as unknown as ZilventorWindow).__zilventorParameterRegistry.getValue(
          'myWidth',
        ) === 80,
      { timeout: 8_000 },
    );

    // Also wait for geometry to move before undoing.
    await page.waitForFunction(
      () => {
        const s = (window as unknown as ZilventorWindow).__zilventorStore.getState();
        const sketchId = s.activeSketchId;
        const sketch = s.activePart?.featureTree.find(
          (f) => f.kind === 'sketch' && (f as { id: string }).id === sketchId,
        );
        if (!sketch || sketch.kind !== 'sketch') return false;
        const l1 = (sketch as { primitives: Primitive[] }).primitives.find(
          (p) => p.id === 'l1',
        );
        return (l1?.x2 ?? 0) > 70;
      },
      { timeout: 8_000 },
    );

    // Undo.
    await page.keyboard.press('Control+z');

    // Registry value should revert to 50.
    await page.waitForFunction(
      () =>
        (window as unknown as ZilventorWindow).__zilventorParameterRegistry.getValue(
          'myWidth',
        ) === 50,
      { timeout: 8_000 },
    );

    // Geometry should revert: x2 back near 50 (< 70).
    await page.waitForFunction(
      () => {
        const s = (window as unknown as ZilventorWindow).__zilventorStore.getState();
        const sketchId = s.activeSketchId;
        const sketch = s.activePart?.featureTree.find(
          (f) => f.kind === 'sketch' && (f as { id: string }).id === sketchId,
        );
        if (!sketch || sketch.kind !== 'sketch') return false;
        const l1 = (sketch as { primitives: Primitive[] }).primitives.find(
          (p) => p.id === 'l1',
        );
        return (l1?.x2 ?? 999) < 70;
      },
      { timeout: 8_000 },
    );

    // Final assertion on registry value.
    const finalVal = await page.evaluate(() =>
      (window as unknown as ZilventorWindow).__zilventorParameterRegistry.getValue('myWidth'),
    );
    expect(finalVal).toBe(50);
  });
});
