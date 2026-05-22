// tests/e2e/drawing/T-6-11-auto-dim.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * T-6-11 — Auto-dim: dispatch AutoDimCommand via real command flow,
 * assert dims placed with correct kinds + sourceParameterName,
 * assert DOM data-dim-text updates on parameter edit,
 * assert undo (revert) removes dims.
 *
 * Pattern: store-injection (same as T-6-9/T-6-10).
 * No real canvas clicks needed — AutoDimCommand dispatched via page.evaluate.
 */
test('T-6-11: Auto-dim — real command flow, dim kinds, cascade text update, undo', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Set up drawing + part with 3 dim-length constraints via store injection.
  // ──────────────────────────────────────────────────────────────────────────
  const { sheetId, baseViewId, drawingId, partId } = await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): unknown;
        setState(p: unknown): void;
      };
    };

    const partId = `part-T611-${Date.now()}`;
    const sheetId = `sheet-T611-${Date.now()}`;
    const baseViewId = `base-T611-${Date.now()}`;
    const drawingId = `drawing-T611-${Date.now()}`;
    const sketchId = `sketch-T611`;

    const primitives = [
      { id: 'line-width',  kind: 'line', x1: 0, y1: 0,  x2: 50, y2: 0  },
      { id: 'line-height', kind: 'line', x1: 0, y1: 0,  x2: 0,  y2: 30 },
      { id: 'line-depth',  kind: 'line', x1: 0, y1: 30, x2: 20, y2: 30 },
    ];
    const constraints = [
      { id: 'c-width',  kind: 'dim-length', line: 'line-width',  paramName: 'width'  },
      { id: 'c-height', kind: 'dim-length', line: 'line-height', paramName: 'height' },
      { id: 'c-depth',  kind: 'dim-length', line: 'line-depth',  paramName: 'depth'  },
    ];

    const activePart = {
      id: partId,
      name: 'T611 Box Part',
      units: 'mm',
      parameters: {
        width:  { name: 'width',  value: 50, unit: 'mm' },
        height: { name: 'height', value: 30, unit: 'mm' },
        depth:  { name: 'depth',  value: 20, unit: 'mm' },
      },
      featureTree: [
        {
          id: sketchId,
          kind: 'sketch',
          name: 'Sketch1',
          primitives,
          constraints,
        },
        {
          id: `extrude-T611`,
          kind: 'extrude',
          name: 'Extrusion1',
          sketchRef: sketchId,
          distanceParam: 'depth',
          operation: 'new',
          direction: 'forward',
        },
      ],
    };

    // NOTE: findMatchingEdge2D projects sketch primitives through buildViewMatrix.
    // It derives sourceBbox from proj.bbox + extrudeDepth as:
    //   sourceBbox = [bbox.minX, bbox.minY, 0, bbox.maxX, bbox.maxY, extrudeDepth]
    // With proj.bbox={0,0,50,30} and extrudeDepth=20:
    //   sourceBbox=[0,0,0,50,30,20], cx=25, cy=15, cz=10
    // For 'front' view: sketch (x,y,0) → projected (x-25, y-15)
    //   line-width  (0,0)→(50,0)   → (-25,-15) → (25,-15)
    //   line-height (0,0)→(0,30)   → (-25,-15) → (-25,15)
    //   line-depth  (0,30)→(20,30) → (-25,15)  → (-5,15)
    // Edges must use these recentered coordinates for the 1e-3 mm tolerance match.
    const baseView = {
      id: baseViewId,
      kind: 'base',
      positionMm: { x: 10, y: 10 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front',
      showHidden: false,
      projection: {
        visibleEdges: [
          { id: 'e-width',  kind: 'outline', points: [[-25,-15],[25,-15]] },
          { id: 'e-height', kind: 'outline', points: [[-25,-15],[-25,15]] },
          { id: 'e-depth',  kind: 'outline', points: [[-25,15],[-5,15]] },
          { id: 'e-top',    kind: 'outline', points: [[-25,15],[25,15]] },
          { id: 'e-right',  kind: 'outline', points: [[25,-15],[25,15]] },
        ],
        hiddenEdges: [],
        // bbox must be the raw sketch bounds so sourceBbox = [0,0,0,50,30,20]
        bbox: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
      },
      inputFingerprint: `fp-T611-${partId}`,
    };

    const drawing = {
      id: drawingId,
      name: 'T-6-11 Drawing',
      units: 'mm',
      source: { partPath: `${partId}.zipt`, sourceKind: 'part' },
      properties: {},
      sheets: [{
        id: sheetId,
        name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' },
        orientation: 'landscape',
        views: [baseView],
        dimensions: [],
        annotations: [],
        titleBlock: {},
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

  // Switch to Drawing tab so the canvas renders.
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator(`g[data-view-id="${baseViewId}"]`)).toBeVisible({ timeout: 10_000 });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Dispatch AutoDimCommand via real command flow (dynamic import + apply).
  // ──────────────────────────────────────────────────────────────────────────
  const applyResult = await page.evaluate(
    async ({ sheetId, baseViewId, drawingId }: { sheetId: string; baseViewId: string; drawingId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument?: {
              kind: string;
              document: {
                sheets: Array<{
                  id: string;
                  dimensions: Array<{ id: string; kind: string; sourceParameterName?: string }>;
                }>;
              };
            };
          };
        };
      };

      const { AutoDimCommand } = await import('/src/commands/AutoDimCommand.ts');
      const cmd = new AutoDimCommand({ drawingId, sheetId, viewId: baseViewId });

      try {
        await cmd.apply();
        const doc = w.__zilventorStore.getState().activeDocument;
        if (doc?.kind !== 'drawing') return { ok: false, error: 'not a drawing doc', dims: [] as Array<{ id: string; kind: string; sourceParameterName?: string }> };
        const sheet = doc.document.sheets.find((s) => s.id === sheetId);
        const dims = sheet?.dimensions ?? [];
        console.log(`[T-6-11] AutoDimCommand placed ${dims.length} dims`);
        return {
          ok: true,
          error: null as string | null,
          dims: dims.map((d) => ({ id: d.id, kind: d.kind, sourceParameterName: d.sourceParameterName })),
        };
      } catch (e) {
        return { ok: false, error: String(e), dims: [] as Array<{ id: string; kind: string; sourceParameterName?: string }> };
      }
    },
    { sheetId, baseViewId, drawingId },
  );

  // ── Assertion (a): at least one dim placed ────────────────────────────────
  expect(applyResult.ok, `AutoDimCommand.apply() failed: ${applyResult.error}`).toBe(true);
  expect(applyResult.dims.length, 'Expected at least 1 dim placed').toBeGreaterThanOrEqual(1);

  // ── Assertion (b): at least one dim has kind='linear-h' and sourceParameterName='width' ──
  const widthDim = applyResult.dims.find(
    (d) => d.kind === 'linear-h' && d.sourceParameterName === 'width',
  );
  expect(widthDim, 'Expected a linear-h dim bound to "width"').toBeDefined();

  // ── Assertion (c): DOM contains [data-dim-id] elements for each placed dim ─
  for (const dim of applyResult.dims) {
    await expect(page.locator(`[data-dim-id="${dim.id}"]`)).toBeVisible({ timeout: 5_000 });
  }

  // ── Mid-flight screenshot (CLAUDE.md §6 — controller reads back) ──────────
  await page.screenshot({ path: '/tmp/drawing-auto-dim-proof.png' });
  console.log('[T-6-11] mid-flight screenshot saved to /tmp/drawing-auto-dim-proof.png');

  // ── Assertion (d): cascade text update after parameter change ─────────────
  await page.evaluate(({ partId }: { partId: string }) => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          activePart: {
            id: string;
            parameters: Record<string, { name: string; value: number; unit: string }>;
            featureTree: unknown[];
          } | null;
        };
        setState(p: unknown): void;
      };
    };
    const s = w.__zilventorStore.getState();
    if (!s.activePart || s.activePart.id !== partId) return;
    const updatedPart = {
      ...s.activePart,
      parameters: {
        ...s.activePart.parameters,
        width: { ...s.activePart.parameters['width'], value: 75 },
      },
    };
    w.__zilventorStore.setState({ activePart: updatedPart });
  }, { partId });

  if (widthDim) {
    const dimTextLocator = page.locator(`[data-dim-id="${widthDim.id}"] [data-dim-text]`);
    await expect(dimTextLocator).toHaveText('75', { timeout: 5_000 });
  }

  // ── Assertion (e): revert removes the dims (undo behavior) ────────────────
  const revertResult = await page.evaluate(
    async ({ sheetId, drawingId, baseViewId }: { sheetId: string; drawingId: string; baseViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument?: {
              kind: string;
              document: {
                sheets: Array<{ id: string; dimensions: unknown[] }>;
              };
            };
          };
        };
      };

      const getCount = () => {
        const doc = w.__zilventorStore.getState().activeDocument;
        if (doc?.kind !== 'drawing') return 0;
        return doc.document.sheets.find((s) => s.id === sheetId)?.dimensions.length ?? 0;
      };

      const { AutoDimCommand } = await import('/src/commands/AutoDimCommand.ts');
      const before = getCount();
      const cmd = new AutoDimCommand({ drawingId, sheetId, viewId: baseViewId });
      await cmd.apply();
      const afterApply = getCount();
      await cmd.revert();
      const afterRevert = getCount();
      return { before, afterApply, afterRevert };
    },
    { sheetId, drawingId, baseViewId },
  );

  expect(revertResult.afterApply, 'apply() should add dims').toBeGreaterThan(revertResult.before);
  expect(revertResult.afterRevert, 'revert() should restore to before count').toBe(revertResult.before);
});
