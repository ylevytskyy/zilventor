// tests/e2e/drawing/T-6-12b-f5render-midflight.spec.ts
/**
 * Task B — Real mid-flight Playwright verification for F5 React renderers.
 *
 * Injects drawing state via store, dispatches AddDimensionGroup/Member/Angular
 * commands, then asserts canvas DOM contains rendered dim elements with the
 * correct data-dim-kind attributes. Takes screenshots proving visible rendering.
 *
 * This is the verification that the previous implementer faked.
 * Screenshots must be distinct in content (bytes differ), showing actual rendered dims.
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

const SCREENSHOT_DIR = '/tmp/f5-screenshots';

test('T-6-12b: F5 React render — baseline/ordinate/angular visible in canvas DOM', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Inject a drawing with projected view.
  // ──────────────────────────────────────────────────────────────────────────
  const ids = await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: { getState(): unknown; setState(p: unknown): void };
    };

    const partId     = `part-T612b-${Date.now()}`;
    const sheetId    = `sheet-T612b-${Date.now()}`;
    const baseViewId = `base-T612b-${Date.now()}`;
    const drawingId  = `drawing-T612b-${Date.now()}`;

    const activePart = {
      id: partId, name: 'T612b Part', units: 'mm',
      parameters: {
        angle: { name: 'angle', value: 45, unit: 'deg' },
      },
      featureTree: [],
    };

    const baseView = {
      id: baseViewId,
      kind: 'base',
      positionMm: { x: 50, y: 50 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front',
      showHidden: false,
      projection: {
        visibleEdges: [
          { id: 'e-datum',   kind: 'outline', points: [[-50, -15], [-50, 15]]  },
          { id: 'e-bm-0',    kind: 'outline', points: [[-30, -15], [-30, 15]]  },
          { id: 'e-bm-1',    kind: 'outline', points: [[-10, -15], [-10, 15]]  },
          { id: 'e-origin',  kind: 'outline', points: [[-50, 0],   [0, 0]]     },
          { id: 'e-om-x0',   kind: 'outline', points: [[20, -5],   [20, 5]]    },
          { id: 'e-om-x1',   kind: 'outline', points: [[40, -5],   [40, 5]]    },
          { id: 'e-ang-1',   kind: 'outline', points: [[0, 0],     [30, 0]]    },
          { id: 'e-ang-2',   kind: 'outline', points: [[0, 0],     [0, 30]]    },
        ],
        hiddenEdges: [],
        bbox: { minX: -50, minY: -15, maxX: 50, maxY: 50 },
      },
      inputFingerprint: `fp-T612b-${partId}`,
    };

    const drawing = {
      id: drawingId, name: 'T-6-12b Drawing', units: 'mm',
      source: { partPath: `${partId}.zipt`, sourceKind: 'part' },
      properties: {},
      sheets: [{
        id: sheetId, name: 'Sheet 1',
        size: { kind: 'iso', size: 'A4' }, orientation: 'landscape',
        views: [baseView],
        dimensions: [], dimensionGroups: [], annotations: [], titleBlock: {},
      }],
      activeSheetId: sheetId,
    };

    w.__zilventorStore.setState({
      activeDocument: { kind: 'drawing', document: drawing },
      activeDrawing: drawing,
      activePart,
    });

    return { sheetId, baseViewId, drawingId, partId };
  });

  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator(`g[data-view-id="${ids.baseViewId}"]`)).toBeVisible({ timeout: 10_000 });

  // ──────────────────────────────────────────────────────────────────────────
  // Screenshot: initial state (no dims yet)
  // ──────────────────────────────────────────────────────────────────────────
  await page.screenshot({ path: `${SCREENSHOT_DIR}/01-initial-no-dims.png` });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Dispatch baseline group + 2 members.
  // ──────────────────────────────────────────────────────────────────────────
  await page.evaluate(
    async ({ sheetId, baseViewId }: { sheetId: string; baseViewId: string }) => {
      const { AddDimensionGroupCommand } = await import('/src/commands/AddDimensionGroupCommand.ts');
      const { AddBaselineMemberCommand } = await import('/src/commands/AddBaselineMemberCommand.ts');

      const groupId = `bg-T612b-${Date.now()}`;
      await new AddDimensionGroupCommand({ sheetId, group: {
        kind: 'baseline', id: groupId, viewId: baseViewId,
        datum: { kind: 'edge-endpoint', edgeId: 'e-datum', end: 'start' },
        direction: 'h', baseOffsetMm: 20, spacingMm: 10,
      }}).apply();
      await new AddBaselineMemberCommand({ sheetId, groupId, to: { kind: 'edge-endpoint', edgeId: 'e-bm-0', end: 'start' } }).apply();
      await new AddBaselineMemberCommand({ sheetId, groupId, to: { kind: 'edge-endpoint', edgeId: 'e-bm-1', end: 'start' } }).apply();
    },
    { sheetId: ids.sheetId, baseViewId: ids.baseViewId },
  );

  // Wait for React to render
  await page.waitForTimeout(500);

  // Assert canvas DOM has baseline dim elements
  const baselineEls = await page.locator('[data-dim-kind="baseline"]').all();
  expect(baselineEls.length).toBeGreaterThanOrEqual(2);

  // Screenshot: with baseline dims rendered
  await page.screenshot({ path: `${SCREENSHOT_DIR}/02-baseline-dims-rendered.png` });
  console.log(`[T-6-12b] Screenshot 02: baseline dims. Count: ${baselineEls.length}`);

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Dispatch ordinate group + 2 x-axis members.
  // ──────────────────────────────────────────────────────────────────────────
  await page.evaluate(
    async ({ sheetId, baseViewId }: { sheetId: string; baseViewId: string }) => {
      const { AddDimensionGroupCommand } = await import('/src/commands/AddDimensionGroupCommand.ts');
      const { AddOrdinateMemberCommand } = await import('/src/commands/AddOrdinateMemberCommand.ts');

      const groupId = `og-T612b-${Date.now()}`;
      await new AddDimensionGroupCommand({ sheetId, group: {
        kind: 'ordinate', id: groupId, viewId: baseViewId,
        origin: { kind: 'edge-endpoint', edgeId: 'e-origin', end: 'start' },
        xColumnOffsetMm: 20, yColumnOffsetMm: 20,
      }}).apply();
      await new AddOrdinateMemberCommand({ sheetId, groupId, to: { kind: 'edge-endpoint', edgeId: 'e-om-x0', end: 'start' }, axis: 'x' }).apply();
      await new AddOrdinateMemberCommand({ sheetId, groupId, to: { kind: 'edge-endpoint', edgeId: 'e-om-x1', end: 'start' }, axis: 'x' }).apply();
    },
    { sheetId: ids.sheetId, baseViewId: ids.baseViewId },
  );

  await page.waitForTimeout(500);

  const ordinateEls = await page.locator('[data-dim-kind="ordinate"]').all();
  expect(ordinateEls.length).toBeGreaterThanOrEqual(2);

  // Screenshot: with ordinate dims rendered
  await page.screenshot({ path: `${SCREENSHOT_DIR}/03-ordinate-dims-rendered.png` });
  console.log(`[T-6-12b] Screenshot 03: ordinate dims. Count: ${ordinateEls.length}`);

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Dispatch angular dim (two-edges).
  // ──────────────────────────────────────────────────────────────────────────
  await page.evaluate(
    async ({ sheetId, baseViewId }: { sheetId: string; baseViewId: string }) => {
      const { AddAngularDimCommand } = await import('/src/commands/AddAngularDimCommand.ts');
      await new AddAngularDimCommand({
        sheetId, viewId: baseViewId,
        ref: { kind: 'two-edges', edge1: { viewId: baseViewId, edgeId: 'e-ang-1' }, edge2: { viewId: baseViewId, edgeId: 'e-ang-2' } },
        arcSide: 'inside', offsetMm: 15,
        opts: { sourceParameterName: 'angle' },
      }).apply();
    },
    { sheetId: ids.sheetId, baseViewId: ids.baseViewId },
  );

  await page.waitForTimeout(500);

  const angularEls = await page.locator('[data-dim-kind="angular"]').all();
  expect(angularEls.length).toBeGreaterThanOrEqual(1);

  // Screenshot: with all 3 dim kinds rendered
  await page.screenshot({ path: `${SCREENSHOT_DIR}/04-all-three-dim-kinds.png` });
  console.log(`[T-6-12b] Screenshot 04: all dim kinds. Angular count: ${angularEls.length}`);

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Verify DOM structure assertions for each kind
  // ──────────────────────────────────────────────────────────────────────────

  // Baseline: should have data-group-id + data-slot attributes
  const firstBaseline = page.locator('[data-dim-kind="baseline"]').first();
  await expect(firstBaseline).toBeVisible();
  const bgGroupId = await firstBaseline.getAttribute('data-group-id');
  expect(bgGroupId).toBeTruthy();
  const bgSlot = await firstBaseline.getAttribute('data-slot');
  expect(bgSlot).toBeTruthy();

  // Each baseline should have >= 3 child lines (2 ext + 1 dim)
  const baselineLines = await firstBaseline.locator('line').all();
  expect(baselineLines.length).toBeGreaterThanOrEqual(3);

  // Ordinate: should have data-axis attribute
  const firstOrdinate = page.locator('[data-dim-kind="ordinate"]').first();
  await expect(firstOrdinate).toBeVisible();
  const ordAxis = await firstOrdinate.getAttribute('data-axis');
  expect(['x', 'y']).toContain(ordAxis);

  // Each ordinate should have >= 2 child lines (L-leader)
  const ordinateLines = await firstOrdinate.locator('line').all();
  expect(ordinateLines.length).toBeGreaterThanOrEqual(2);

  // Angular: should have data-arc-side + a path with 'A' arc command
  const firstAngular = page.locator('[data-dim-kind="angular"]').first();
  await expect(firstAngular).toBeVisible();
  const arcSide = await firstAngular.getAttribute('data-arc-side');
  expect(['inside', 'outside']).toContain(arcSide);
  const angPath = firstAngular.locator('path').first();
  const pathD = await angPath.getAttribute('d');
  expect(pathD).toContain('A');

  // Final screenshot
  await page.screenshot({ path: `${SCREENSHOT_DIR}/05-assertions-passed.png` });
  console.log('[T-6-12b] All DOM assertions passed. Screenshots saved to /tmp/f5-screenshots/');
});
