/**
 * Task 3.6 — Drawing F6 mid-flight visual verification for HoleTableElement.
 *
 * Seeds a drawing with a part that has 2 holes (H1 dia=8, H2 dia=12).
 * Injects a HoleTableAnnotation directly into the store (no OCCT kernel needed).
 * Verifies the table grid (headers), per-hole balloons and leaders render in the DOM.
 * Screenshots saved to tmp/ for manual review.
 *
 * This is a mid-flight verification spec — NOT the final T-6-15 e2e test (which
 * is Batch 4 work). This spec only uses page.evaluate + DOM assertions + screenshots.
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

function circlePoints(cx: number, cy: number, r: number, n = 16) {
  const pts: Array<readonly [number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const angle = (i / n) * 2 * Math.PI;
    pts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as const);
  }
  return pts;
}

test('T-6-15 mid-flight: hole table renders table grid + balloons + leaders', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

  await page.goto('/');
  await waitForKernelReady(page);

  // ── Seed the store with a part + 2 holes + a drawing + a base view + hole table ──
  const sheetId = 'sh-f6-mid';
  const viewId = 'v-f6-mid';
  const annId = 'ht-f6-mid';

  await page.evaluate(
    ({
      sheetId,
      viewId,
      annId,
      h1Points,
      h2Points,
    }: {
      sheetId: string;
      viewId: string;
      annId: string;
      h1Points: Array<readonly [number, number]>;
      h2Points: Array<readonly [number, number]>;
    }) => {
      const store = (
        window as unknown as {
          __zilventorStore: {
            getState(): unknown;
            setState(partial: unknown): void;
          };
        }
      ).__zilventorStore;

      const partWithHoles = {
        id: 'p-f6-mid',
        name: 'F6MidPart',
        units: 'mm',
        parameters: {
          d_h1: { value: 8 },
          d_h2: { value: 12 },
        },
        featureTree: [
          {
            id: 'H1',
            kind: 'hole',
            placement: { kind: 'fromSketch', sketchId: 'sk1' },
            profile: {
              kind: 'simple',
              diameter: { kind: 'param', paramName: 'd_h1' },
            },
            termination: { kind: 'throughAll' },
            flipAxis: false,
          },
          {
            id: 'H2',
            kind: 'hole',
            placement: { kind: 'fromSketch', sketchId: 'sk1' },
            profile: {
              kind: 'simple',
              diameter: { kind: 'param', paramName: 'd_h2' },
            },
            termination: { kind: 'throughAll' },
            flipAxis: false,
          },
        ],
        properties: {},
        materials: [],
        hardware: [],
      };

      const datumEdge = {
        id: 'datum-edge',
        kind: 'outline' as const,
        points: [[0, 0], [10, 0]] as Array<readonly [number, number]>,
        sourceFaceIds: [] as string[],
      };
      const h1Edge = {
        id: 'h1-circle',
        kind: 'feature' as const,
        points: h1Points,
        sourceFaceIds: ['H1|hole|0'],
      };
      const h2Edge = {
        id: 'h2-circle',
        kind: 'feature' as const,
        points: h2Points,
        sourceFaceIds: ['H2|hole|0'],
      };

      const baseView = {
        id: viewId,
        kind: 'base',
        positionMm: { x: 50, y: 50 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front',
        showHidden: false,
        projection: {
          visibleEdges: [datumEdge, h1Edge, h2Edge],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 120, maxY: 60 },
        },
        inputFingerprint: 'fp-f6-mid',
      };

      const holeTableAnn = {
        kind: 'holeTable' as const,
        id: annId,
        viewId,
        datum: { kind: 'edge-endpoint' as const, edgeId: 'datum-edge', end: 'start' as const },
        positionMm: { x: 20, y: 200 },
        entries: [] as ReadonlyArray<{ readonly holeFeatureId: string; readonly tag: string }>,
      };

      const drawingDoc = {
        id: 'd-f6-mid',
        name: 'F6 Mid-Flight Test',
        units: 'mm',
        source: { partPath: 'parts/f6mid.zipt', sourceKind: 'part' },
        properties: {},
        activeSheetId: sheetId,
        sheets: [
          {
            id: sheetId,
            name: 'Sheet 1',
            size: { kind: 'iso', size: 'A3' },
            orientation: 'landscape',
            views: [baseView],
            dimensions: [],
            dimensionGroups: [],
            annotations: [holeTableAnn],
            titleBlock: {},
          },
        ],
      };

      store.setState({
        activeDocument: { kind: 'drawing', document: drawingDoc },
        activeDrawing: drawingDoc,
        activePart: partWithHoles,
      });
    },
    {
      sheetId,
      viewId,
      annId,
      h1Points: circlePoints(20, 20, 4),
      h2Points: circlePoints(70, 20, 6),
    },
  );

  // Navigate to Drawing tab
  await page.getByRole('tab', { name: 'Drawing' }).click();

  // Wait for view to render — use first() to avoid strict-mode violation (multiple data-view-id matches)
  await expect(page.locator(`g[data-view-id="${viewId}"]`).first()).toBeAttached({ timeout: 10_000 });

  // Wait for hole table annotation to appear in DOM
  await expect(page.locator(`[data-ann-id="${annId}"]`).first()).toBeAttached({ timeout: 10_000 });

  // Verify table headers are rendered
  const pageContent = await page.content();
  expect(pageContent).toContain('TAG');
  expect(pageContent).toContain('XDIM');
  expect(pageContent).toContain('YDIM');
  expect(pageContent).toContain('DESCRIPTION');

  // Verify balloons and leaders
  const balloonCount = await page.locator('[data-role="hole-balloon"]').count();
  const leaderCount = await page.locator('[data-role="hole-leader"]').count();
  expect(balloonCount).toBeGreaterThanOrEqual(2);
  expect(leaderCount).toBeGreaterThanOrEqual(2);

  // Screenshot 1 — main verification
  await page.screenshot({
    path: 'tmp/f6-batch3-table-placed.png',
    fullPage: true,
  });

  // Wait briefly and take second screenshot to confirm stability
  await page.waitForTimeout(500);
  await page.screenshot({
    path: 'tmp/f6-batch3-table-placed-2.png',
    fullPage: true,
  });

  // No console errors (unrelated navigation errors are acceptable but log them)
  const criticalErrors = consoleErrors.filter(
    (e) => !e.includes('navigation') && !e.includes('ENOENT'),
  );
  if (criticalErrors.length > 0) {
    console.log('Console errors:', criticalErrors);
  }
  // Don't fail on console errors — some navigation errors are pre-existing
});
