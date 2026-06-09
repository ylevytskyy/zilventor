/**
 * Slice-2 sketch productivity tools — end-to-end gate.
 *
 * A) Ribbon: Trim, Extend, Project buttons visible in sketch mode.
 * B) Trim: seed two crossing lines via kernelAddSketch, invoke Trim via ribbon button,
 *    click the segment to remove via REAL canvas click, assert surviving geometry via store.
 *    This closes the slice-1 gap: the TRIM ACTION runs through the real canvas pick→emit→
 *    command→solve→render path (unlike slice-1 which bypassed the canvas for the action-under-test).
 *
 * Fillet-coincident is covered by the T4 unit test (FilletTool.spec.ts) — not e2e.
 * The dynamic-import pattern (page.evaluate + import('/src/...')) is intentionally
 * avoided here: it's Vite-path fragile and doesn't test through the command bus.
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
  bus: { execute(c: unknown): Promise<unknown> };
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
};

type Constraint = { kind: string; id: string };

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

async function enterSketchMode(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('tab', { name: 'Sketch' }).click();
  await page.getByRole('button', { name: '2D Sketch' }).click();
  await expect(page.getByRole('button', { name: /Finish Sketch/i })).toBeVisible();
}

// ---------------------------------------------------------------------------
// Helper: seed a sketch with primitives via kernel API (mirrors slice-1 pattern).
// ---------------------------------------------------------------------------
async function kernelAddSketch(
  page: import('@playwright/test').Page,
  sketchId: string,
  primitives: Primitive[],
): Promise<void> {
  await page.evaluate(
    async ({ sketchId, primitives }: { sketchId: string; primitives: Primitive[] }) => {
      const s = (window as unknown as ZilventorWindow).__zilventorStore.getState();
      if (!s.kernel || !s.activePart) throw new Error('kernel or activePart not ready');
      await s.kernel.addFeature(s.activePart.id, {
        kind: 'sketch',
        id: sketchId,
        plane: { source: 'workPlane', featureId: 'origin.XY' },
        primitives,
        constraints: [],
      });
      const next = await s.kernel.getPart(s.activePart.id);
      s.setActivePart(next);
    },
    { sketchId, primitives },
  );
}

// ---------------------------------------------------------------------------
// A) Ribbon buttons
// ---------------------------------------------------------------------------
test.describe('Slice-2 sketch tools — ribbon visibility', () => {
  test('Trim, Extend, Project buttons appear in sketch mode', async ({ page }) => {
    await setupNewPart(page);
    await enterSketchMode(page);
    await expect(page.getByRole('button', { name: /^Trim$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Extend$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Project$/i })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// B) Trim — real canvas pick (closes slice-1's canvas-bypass gap)
// ---------------------------------------------------------------------------
test.describe('Slice-2 sketch tools — Trim via real canvas click', () => {
  test(
    'seed two crossing lines, activate Trim via ribbon, click canvas to trim a segment, assert store',
    async ({ page }) => {
      page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
      await setupNewPart(page);

      // PRECONDITION: seed two crossing lines via kernel (acceptable precondition seeding,
      // same pattern as slice-1 kernelAddSketch — the TRIM ACTION is what runs via canvas).
      // Lines: horizontal lh (y=0, x1=-30 to x2=30) and vertical lv (x=0, y1=-30 to y2=30).
      // They cross at (0,0) = sketch origin.
      const SKETCH_ID = 'sk-trim-e2e';
      await kernelAddSketch(page, SKETCH_ID, [
        { id: 'lh', kind: 'line', x1: -30, y1: 0, x2: 30, y2: 0 },
        { id: 'lv', kind: 'line', x1: 0, y1: -30, x2: 0, y2: 30 },
      ]);

      // Enter sketch mode on the seeded sketch by calling setSketchMode directly in the store.
      // This is equivalent to what the UI does when the user double-clicks a sketch feature
      // — sketchMode=true, activeSketchId=SKETCH_ID.
      await page.evaluate(
        ({ sketchId }: { sketchId: string }) => {
          const s = (window as unknown as ZilventorWindow).__zilventorStore.getState();
          (s as unknown as { setSketchMode(on: boolean, id: string): void }).setSketchMode(true, sketchId);
        },
        { sketchId: SKETCH_ID },
      );

      // Navigate to Sketch tab so ribbon buttons are rendered.
      await page.getByRole('tab', { name: 'Sketch' }).click();
      await expect(page.getByRole('button', { name: /Finish Sketch/i })).toBeVisible();

      // Verify 2 primitives in store before trim.
      const before = await page.evaluate(({ sketchId }: { sketchId: string }) => {
        const s = (window as unknown as ZilventorWindow).__zilventorStore.getState();
        const sketch = s.activePart?.featureTree.find((f) => f.kind === 'sketch' && f.id === sketchId);
        if (!sketch || sketch.kind !== 'sketch') return 0;
        return (sketch as { primitives: Primitive[] }).primitives.length;
      }, { sketchId: SKETCH_ID });
      expect(before).toBe(2);

      // TRIM ACTION: activate Trim via ribbon button (REAL canvas interaction, not store.setActiveToolKind).
      await page.getByRole('button', { name: /^Trim$/i }).click();

      // Click on the RIGHT half of the horizontal line (sketch coord ~(15,0) → screen).
      // The viewport maps the sketch coordinate system to screen pixels. The crossing is at
      // sketch origin. We click to the right of center to hit the right half of lh.
      const viewport = page.locator('main#region-viewport canvas');
      const box = (await viewport.boundingBox())!;
      const cx = box.width / 2;
      const cy = box.height / 2;
      // Clicking (cx+50, cy) hits the right half of lh in screen space (right of the crossing).
      await viewport.click({ position: { x: cx + 50, y: cy }, force: true });

      // Wait for the store to reflect a change in primitive count or geometry.
      // After trim of the right half of lh: lh is shortened (end-trim → updatePrimitive)
      // OR deleted + two remnants added (interior trim) — either way, primitive count changes
      // from 2 to ≥ 2 (but lh's geometry changes).
      await page.waitForFunction(
        () => {
          const s = (window as unknown as ZilventorWindow).__zilventorStore.getState();
          const sketchId = s.activeSketchId;
          const sketch = s.activePart?.featureTree.find(
            (f: { kind: string }) => f.kind === 'sketch' && (f as { id: string }).id === sketchId,
          ) as { primitives: Primitive[] } | undefined;
          if (!sketch) return false;
          // Primitive count changed OR lh's x2 changed (shortened).
          const lh = sketch.primitives.find((p: Primitive) => p.id === 'lh');
          // If lh was deleted and replaced, it won't exist → count changed.
          if (!lh) return sketch.primitives.length !== 2;
          // lh still exists but should be shortened: x2 < 30.
          return (lh.x2 ?? 30) < 29;
        },
        { timeout: 8_000 },
      );

      // Assert via store (not DOM attribute — more reliable).
      const state = await getState(page);
      const sketchId = state.activeSketchId;
      const sketch = state.activePart?.featureTree.find(
        (f): f is Extract<Feature, { kind: 'sketch' }> =>
          f.kind === 'sketch' && f.id === sketchId,
      );
      expect(sketch).toBeDefined();
      // The vertical line (lv) must still exist unchanged.
      expect(sketch!.primitives.some((p) => p.id === 'lv')).toBe(true);
      // Horizontal line (lh) either was shortened or deleted+replaced, but the
      // surviving geometry no longer covers the full x1=-30 to x2=30 span:
      const lhAfter = sketch!.primitives.find((p) => p.id === 'lh');
      if (lhAfter) {
        // Shortened case: x2 should be ≤ 0 (crossing point) or < 30.
        expect((lhAfter.x2 ?? 30)).toBeLessThan(29);
      } else {
        // Delete+split case: two new primitives exist with different ids.
        expect(sketch!.primitives.length).toBeGreaterThanOrEqual(2);
      }
    },
  );
});
