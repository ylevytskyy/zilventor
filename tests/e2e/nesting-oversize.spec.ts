/**
 * E2E §6: Nesting oversize — GenerateNestCommand persists oversize params and
 *          grows placed-panel dimensions by the requested allowance.
 *
 * PROBE STRATEGY (headless viewport is BLACK — no screenshots, only store/DOM probes):
 *   1. UI probe: NestDialog renders "Length oversize" and "Width oversize" inputs
 *      (aria-label from en.json: "Length oversize" / "Width oversize").
 *   2. Store probe: after GenerateNestCommand with oversize={lengthMm:50, widthMm:0},
 *      activeAssembly.nest.params.oversize persists {lengthMm:50, widthMm:0}.
 *   3. Geometry probe: a placed panel's .length == net panel length + 50 (exactly),
 *      while baseline (oversize=0) placed panel .length == net panel length.
 *      Delta = +50 proves packGuillotine applied rawL = r.length + oversize.lengthMm.
 *   4. Undo probe: bus.undo() reverts nest back to the baseline state (params.oversize
 *      absent, placed panel .length = net length).
 *   5. Zero browser errors.
 *
 * Two tests:
 *   A. Synthetic-dispatch (fast): drives GenerateNestCommand directly with a
 *      synthetic CutListResult — quick smoke test of the command itself.
 *   B. Real-UI handler (full §6): seeds a panel to OPFS, warms the panelSpecCacheRef
 *      via __zilventorLoadCutListSpecs, opens NestDialog via the Furniture tab
 *      "Generate Nest" button, fills inputs, and clicks the real OK button.
 *      This exercises the handleOk → bus.execute path with the live cutListResult
 *      from useCutListResult (NOT a synthetic CutListResult).
 *
 * Implementation notes (synthetic test):
 *   - We construct a synthetic CutListResult directly (fixed panel dimensions known
 *     a-priori from a 600×560×720mm base cabinet side panel: 720×560mm carcass panel
 *     after normalisation to L=max/W=min: 720×560). We skip the recursive aggregation
 *     because panelSpecCacheRef is a React context ref not reachable from page.evaluate.
 *   - The synthetic cut list has ONE row (qty=1) so we can assert exact placed dims.
 *   - Materials must include sheetLengthMm/sheetWidthMm so packAllMaterials does not
 *     exclude the material with reason='no-sheet-stock'.
 *   - NestDialog is opened via store.setNestDialog({ kind:'open' }) — the UI path
 *     requires FurnitureTab cut list population which relies on the React cache; the
 *     store setter is the same code path the UI button uses (OpenNestDialogCommand).
 *   - Undo uses __zilventorStore.getState().bus.undo() — NOT a dynamic useAppStore
 *     import — to guarantee the same bus instance as bus.execute.
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';
import { seedAssemblyPanelPart } from './helpers/seedAssemblyPanelPart';

const MATERIAL_ID = 'm-birch-18-nest';
const PANEL_LENGTH = 720; // net panel length (mm) — arbitrary but realistic
const PANEL_WIDTH  = 560; // net panel width  (mm)
const SHEET_L      = 2800;
const SHEET_W      = 2070;
const OVERSIZE_L   = 50;

test(
  'nesting-oversize: NestDialog inputs render, GenerateNestCommand persists oversize, placed dims grow by +50, undo reverts',
  async ({ page }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(120_000);

    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      console.log('BROWSER:', m.type(), m.text());
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => {
      console.log('PAGEERROR:', e.message);
      consoleErrors.push(`PAGEERROR: ${e.message}`);
    });

    await page.goto('/');
    await waitForKernelReady(page);

    // ── 1. New assembly ────────────────────────────────────────────────────────
    await page.getByRole('tab', { name: 'File' }).click();
    await page.getByRole('button', { name: /new assembly/i }).click();
    await page.waitForFunction(() => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
      };
      return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
    });

    // ── 2. Register material with sheet stock (required for nesting) ────────────
    await page.evaluate((matId: string) => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { addMaterial(m: unknown): void } };
      };
      w.__zilventorStore.getState().addMaterial({
        id: matId,
        name: 'Birch 18mm (nest test)',
        defaultThickness: 18,
        color: '#d8c896',
        sheetLengthMm: 2800,
        sheetWidthMm: 2070,
      });
    }, MATERIAL_ID);

    // ── 3. Open NestDialog via store setter — same path as OpenNestDialogCommand ─
    await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { setNestDialog(s: { kind: 'open' } | null): void };
        };
      };
      w.__zilventorStore.getState().setNestDialog({ kind: 'open' });
    });

    // ── 4. Assert NestDialog is visible with the correct inputs ──────────────────
    const dialog = page.getByRole('dialog', { name: 'Nest dialog' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    const lengthOversizeInput = dialog.getByLabel('Length oversize');
    const widthOversizeInput  = dialog.getByLabel('Width oversize');
    await expect(lengthOversizeInput).toBeVisible();
    await expect(widthOversizeInput).toBeVisible();
    console.log('[nest-oversize] NestDialog inputs are visible — PASS');

    // Close the dialog before programmatic command invocation.
    await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { setNestDialog(s: null): void };
        };
      };
      w.__zilventorStore.getState().setNestDialog(null);
    });
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });

    // ── 5. Baseline: GenerateNestCommand with NO oversize ──────────────────────
    // Build a minimal synthetic CutListResult with one known-size panel.
    // This avoids needing the React panelSpecCacheRef from page context.
    const baselineNest = await page.evaluate(
      async (args: { matId: string; panelL: number; panelW: number; sheetL: number; sheetW: number }) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): {
              bus: { execute(c: unknown): Promise<void> };
              activeAssembly: { nest?: unknown; materials: unknown[] } | null;
            };
          };
        };
        const { GenerateNestCommand } = await import('/src/commands/GenerateNestCommand.ts');
        const store = w.__zilventorStore.getState();

        // Synthetic CutListResult — one side panel at known net dims.
        const syntheticResult = {
          rows: [{
            rowKey: `L=${args.panelL}|W=${args.panelW}|T=18|M=${args.matId}|G=none`,
            itemNumber: 1,
            qty: 1,
            length: args.panelL,
            width: args.panelW,
            thickness: 18,
            materialId: args.matId,
            materialName: 'Birch 18mm (nest test)',
            grain: 'none' as const,
            edgeBands: { front: null, back: null, left: null, right: null },
            partPath: 'panels/side.zipt',
            partName: 'Side',
            componentPathKeys: ['c1'],
          }],
          bandTotals: [],
          excluded: { componentCount: 0, partCount: 0 },
        };

        const materials = [{
          id: args.matId,
          name: 'Birch 18mm (nest test)',
          defaultThickness: 18,
          color: '#d8c896',
          sheetLengthMm: args.sheetL,
          sheetWidthMm: args.sheetW,
        }];

        const cmd = new GenerateNestCommand({
          kerfMm: 3,
          // no oversize — baseline
          result: syntheticResult,
          materials,
        });
        await store.bus.execute(cmd);
        return w.__zilventorStore.getState().activeAssembly?.nest ?? null;
      },
      { matId: MATERIAL_ID, panelL: PANEL_LENGTH, panelW: PANEL_WIDTH, sheetL: SHEET_L, sheetW: SHEET_W },
    );

    expect(baselineNest, 'baseline nest must be set in activeAssembly').not.toBeNull();
    const baselineNestTyped = baselineNest as {
      params: { kerfMm: number; oversize?: { lengthMm: number; widthMm: number } };
      sheets: Array<{ panels: Array<{ length: number; width: number }> }>;
    };

    expect(
      baselineNestTyped.params.oversize,
      'baseline nest must have NO oversize (undefined or absent)',
    ).toBeUndefined();

    expect(
      baselineNestTyped.sheets.length,
      'baseline nest must produce at least 1 sheet',
    ).toBeGreaterThan(0);
    expect(
      baselineNestTyped.sheets[0]!.panels.length,
      'baseline sheet must contain at least 1 placed panel',
    ).toBeGreaterThan(0);

    const baselinePlacedLength = baselineNestTyped.sheets[0]!.panels[0]!.length;
    const baselinePlacedWidth  = baselineNestTyped.sheets[0]!.panels[0]!.width;
    console.log(
      `[nest-oversize] baseline placed: length=${baselinePlacedLength} width=${baselinePlacedWidth}`,
    );

    // Baseline placed length should equal net panel length (no oversize).
    expect(
      baselinePlacedLength,
      `baseline placed length must equal net panel length=${PANEL_LENGTH}`,
    ).toBe(PANEL_LENGTH);

    // ── 6. Undo baseline GenerateNestCommand (to ensure clean undo stack probe later) ─
    // We undo it now so the next command is the only one on the stack.
    await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { undo(): Promise<boolean> } } };
      };
      await w.__zilventorStore.getState().bus.undo();
    });

    // ── 7. GenerateNestCommand WITH oversize={lengthMm:50, widthMm:0} ──────────
    const oversizeNest = await page.evaluate(
      async (args: { matId: string; panelL: number; panelW: number; sheetL: number; sheetW: number; oversizeL: number }) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): {
              bus: { execute(c: unknown): Promise<void> };
              activeAssembly: { nest?: unknown } | null;
            };
          };
        };
        const { GenerateNestCommand } = await import('/src/commands/GenerateNestCommand.ts');
        const store = w.__zilventorStore.getState();

        const syntheticResult = {
          rows: [{
            rowKey: `L=${args.panelL}|W=${args.panelW}|T=18|M=${args.matId}|G=none`,
            itemNumber: 1,
            qty: 1,
            length: args.panelL,
            width: args.panelW,
            thickness: 18,
            materialId: args.matId,
            materialName: 'Birch 18mm (nest test)',
            grain: 'none' as const,
            edgeBands: { front: null, back: null, left: null, right: null },
            partPath: 'panels/side.zipt',
            partName: 'Side',
            componentPathKeys: ['c1'],
          }],
          bandTotals: [],
          excluded: { componentCount: 0, partCount: 0 },
        };

        const materials = [{
          id: args.matId,
          name: 'Birch 18mm (nest test)',
          defaultThickness: 18,
          color: '#d8c896',
          sheetLengthMm: args.sheetL,
          sheetWidthMm: args.sheetW,
        }];

        const cmd = new GenerateNestCommand({
          kerfMm: 3,
          oversize: { lengthMm: args.oversizeL, widthMm: 0 },
          result: syntheticResult,
          materials,
        });
        await store.bus.execute(cmd);
        return w.__zilventorStore.getState().activeAssembly?.nest ?? null;
      },
      { matId: MATERIAL_ID, panelL: PANEL_LENGTH, panelW: PANEL_WIDTH, sheetL: SHEET_L, sheetW: SHEET_W, oversizeL: OVERSIZE_L },
    );

    expect(oversizeNest, 'oversize nest must be set in activeAssembly').not.toBeNull();
    const oversizeNestTyped = oversizeNest as {
      params: { kerfMm: number; oversize?: { lengthMm: number; widthMm: number } };
      sheets: Array<{ panels: Array<{ length: number; width: number }> }>;
    };

    // ── 8. Assert params.oversize persisted correctly ─────────────────────────
    expect(
      oversizeNestTyped.params.oversize,
      'oversize nest params.oversize must be {lengthMm:50, widthMm:0}',
    ).toEqual({ lengthMm: OVERSIZE_L, widthMm: 0 });
    console.log(
      '[nest-oversize] params.oversize =',
      JSON.stringify(oversizeNestTyped.params.oversize),
      '— PASS',
    );

    // ── 9. Assert placed panel grew by exactly +50 in the length direction ─────
    expect(
      oversizeNestTyped.sheets.length,
      'oversize nest must produce at least 1 sheet',
    ).toBeGreaterThan(0);
    expect(
      oversizeNestTyped.sheets[0]!.panels.length,
      'oversize sheet must contain at least 1 placed panel',
    ).toBeGreaterThan(0);

    const oversizePlacedLength = oversizeNestTyped.sheets[0]!.panels[0]!.length;
    const oversizePlacedWidth  = oversizeNestTyped.sheets[0]!.panels[0]!.width;
    console.log(
      `[nest-oversize] oversize placed: length=${oversizePlacedLength} width=${oversizePlacedWidth}`,
      `(expected: length=${PANEL_LENGTH + OVERSIZE_L}, width=${PANEL_WIDTH})`,
    );

    expect(
      oversizePlacedLength,
      `placed length must equal net=${PANEL_LENGTH} + oversize=${OVERSIZE_L} = ${PANEL_LENGTH + OVERSIZE_L}`,
    ).toBe(PANEL_LENGTH + OVERSIZE_L);

    expect(
      oversizePlacedWidth,
      `placed width must equal net=${PANEL_WIDTH} (oversize.widthMm=0 → no change)`,
    ).toBe(PANEL_WIDTH);

    const delta = oversizePlacedLength - baselinePlacedLength;
    console.log(
      `[nest-oversize] length delta: baseline=${baselinePlacedLength} oversize=${oversizePlacedLength} delta=+${delta}`,
    );
    expect(
      delta,
      `placed length must grow by exactly +${OVERSIZE_L}mm (baseline=${baselinePlacedLength}, oversize=${oversizePlacedLength})`,
    ).toBe(OVERSIZE_L);

    // ── 10. Undo oversize GenerateNestCommand ─────────────────────────────────
    await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { undo(): Promise<boolean> } } };
      };
      const result = await w.__zilventorStore.getState().bus.undo();
      if (!result) throw new Error('bus.undo() returned false — nothing to undo');
    });

    // ── 11. Assert nest reverts (back to undefined — we undid the baseline first) ─
    const nestAfterUndo = await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { activeAssembly: { nest?: unknown } | null };
        };
      };
      return w.__zilventorStore.getState().activeAssembly?.nest ?? null;
    });

    expect(
      nestAfterUndo,
      'undo must revert activeAssembly.nest to null/undefined (the oversize GenerateNest is undone)',
    ).toBeNull();
    console.log('[nest-oversize] undo reverted nest — PASS');

    // ── 12. Zero browser errors ───────────────────────────────────────────────
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('favicon'),
    );
    expect(realErrors, 'no browser errors during nesting-oversize e2e flow').toHaveLength(0);
  },
);

/**
 * Real-UI handler test (§6 full path):
 *
 * Seeds a real panel to OPFS, warms the panelSpecCacheRef, opens NestDialog
 * via the Furniture tab "Generate Nest" button, fills the oversize input, and
 * clicks the real OK button. This exercises the handleOk → bus.execute path
 * with the live cutListResult from useCutListResult (NOT a synthetic dispatch).
 *
 * Gap closed: the synthetic test above calls GenerateNestCommand directly, bypassing
 * the dialog's handleOk handler and the live useCutListResult hook. This test
 * proves that the real UI path (button → dialog → OK) produces identical results.
 */
test(
  'nesting-oversize: real UI handler — Furniture tab "Generate Nest" → fill oversize → click OK → nest persists with +50 growth',
  async ({ page }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(120_000);

    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      console.log('BROWSER-UI:', m.type(), m.text());
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => {
      console.log('PAGEERROR-UI:', e.message);
      consoleErrors.push(`PAGEERROR: ${e.message}`);
    });

    await page.goto('/');
    await waitForKernelReady(page);

    // ── 1. New assembly ────────────────────────────────────────────────────────
    await page.getByRole('tab', { name: 'File' }).click();
    await page.getByRole('button', { name: /new assembly/i }).click();
    await page.waitForFunction(() => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
      };
      return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
    });

    // ── 2. Register material with sheet stock ──────────────────────────────────
    const REAL_MAT_ID = 'm-birch-18-real-ui';
    await page.evaluate((matId: string) => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { addMaterial(m: unknown): void } };
      };
      w.__zilventorStore.getState().addMaterial({
        id: matId,
        name: 'Birch 18mm (real-ui test)',
        defaultThickness: 18,
        color: '#d8c896',
        sheetLengthMm: 2800,
        sheetWidthMm: 2070,
      });
    }, REAL_MAT_ID);

    // ── 3. Seed a panel part to OPFS and add it as a component ────────────────
    // Panel: 720×560×18mm (birch) — same dims as synthetic test for easy comparison.
    const REAL_PANEL_L = 720;
    const REAL_PANEL_W = 560;
    const PART_PATH = 'panels/nest-real-ui-side.zipt';

    await seedAssemblyPanelPart(page, {
      partPath: PART_PATH,
      partName: 'Side (real-ui)',
      length: REAL_PANEL_L,
      width: REAL_PANEL_W,
      thickness: 18,
      materialId: REAL_MAT_ID,
      grain: 'none',
      materials: [{ id: REAL_MAT_ID, name: 'Birch 18mm (real-ui test)', defaultThickness: 18, color: '#d8c896' }],
    });

    await page.evaluate((partPath: string) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            addComponent(c: {
              id: string; partPath: string;
              position: { x: number; y: number; z: number };
              rotation: { rx: number; ry: number; rz: number };
              visible: boolean;
            }): void;
          };
        };
      };
      w.__zilventorStore.getState().addComponent({
        id: 'nest-real-ui-c1',
        partPath,
        position: { x: 0, y: 0, z: 0 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
      });
    }, PART_PATH);

    // Wait for component to appear.
    await page.waitForFunction(() => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { activeAssembly?: { components: unknown[] } | null } };
      };
      return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) >= 1;
    });

    // ── 4. Warm panelSpecCacheRef via __zilventorLoadCutListSpecs ─────────────
    // This is required so useCutListResult in NestDialog returns non-empty rows.
    await page.evaluate(async () => {
      const w = window as unknown as { __zilventorLoadCutListSpecs?: () => Promise<void> };
      await w.__zilventorLoadCutListSpecs?.();
    });

    // ── 5. BASELINE — click "Generate Nest" on Furniture tab, OK with defaults ─
    // Open Furniture tab.
    await page.getByRole('tab', { name: 'Furniture' }).click();

    // Click "Generate Nest" button — opens NestDialog.
    await page.getByRole('button', { name: 'Generate Nest' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nest dialog' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    console.log('[nest-oversize-ui] NestDialog opened via real Furniture tab button — PASS');

    // Verify inputs are visible.
    const kerfInput = dialog.getByLabel('Kerf');
    const lengthOversizeInput = dialog.getByLabel('Length oversize');
    const widthOversizeInput = dialog.getByLabel('Width oversize');
    await expect(kerfInput).toBeVisible();
    await expect(lengthOversizeInput).toBeVisible();
    await expect(widthOversizeInput).toBeVisible();

    // Click OK with default values (kerf=3, oversize-l=0, oversize-w=0).
    const okButton = dialog.getByRole('button', { name: 'OK' });
    await expect(okButton).toBeEnabled({ timeout: 5_000 });
    await okButton.click();

    // Dialog closes after OK.
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });
    console.log('[nest-oversize-ui] baseline OK clicked, dialog closed — PASS');

    // Read baseline nest from store.
    const baselineNest = await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { activeAssembly: { nest?: unknown } | null };
        };
      };
      return w.__zilventorStore.getState().activeAssembly?.nest ?? null;
    });

    expect(baselineNest, 'baseline nest must be set after real OK click').not.toBeNull();
    const baselineTyped = baselineNest as {
      params: { kerfMm: number; oversize?: { lengthMm: number; widthMm: number } };
      sheets: Array<{ panels: Array<{ length: number; width: number }> }>;
    };

    // Baseline: params.oversize must be absent (both oversize fields were 0).
    expect(
      baselineTyped.params.oversize,
      'baseline params.oversize must be undefined (both inputs were 0)',
    ).toBeUndefined();

    expect(baselineTyped.sheets.length, 'baseline must produce ≥1 sheet').toBeGreaterThan(0);
    expect(
      baselineTyped.sheets[0]!.panels.length,
      'baseline sheet must contain ≥1 panel',
    ).toBeGreaterThan(0);

    const baselinePlacedL = baselineTyped.sheets[0]!.panels[0]!.length;
    console.log(`[nest-oversize-ui] baseline placed length=${baselinePlacedL} (expected ${REAL_PANEL_L})`);
    expect(
      baselinePlacedL,
      `baseline placed length must equal net panel length ${REAL_PANEL_L}`,
    ).toBe(REAL_PANEL_L);

    // ── 6. OVERSIZE — re-open dialog, fill oversize-L=50, click OK ───────────
    // Navigate back to Furniture tab (dialog closed, tab may still be active).
    await page.getByRole('tab', { name: 'Furniture' }).click();
    await page.getByRole('button', { name: 'Generate Nest' }).click();
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    console.log('[nest-oversize-ui] NestDialog reopened for oversize run — PASS');

    // Fill "50" in the length oversize field (clear default "0" first).
    await lengthOversizeInput.fill('50');

    // Click OK.
    await expect(okButton).toBeEnabled({ timeout: 5_000 });
    await okButton.click();
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });
    console.log('[nest-oversize-ui] oversize OK clicked, dialog closed — PASS');

    // Read oversize nest from store.
    const oversizeNest = await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { activeAssembly: { nest?: unknown } | null };
        };
      };
      return w.__zilventorStore.getState().activeAssembly?.nest ?? null;
    });

    expect(oversizeNest, 'oversize nest must be set after real OK click').not.toBeNull();
    const oversizeTyped = oversizeNest as {
      params: { kerfMm: number; oversize?: { lengthMm: number; widthMm: number } };
      sheets: Array<{ panels: Array<{ length: number; width: number }> }>;
    };

    // ── 7. Assert params.oversize is correct ──────────────────────────────────
    expect(
      oversizeTyped.params.oversize,
      'oversize params.oversize must be {lengthMm:50, widthMm:0}',
    ).toEqual({ lengthMm: 50, widthMm: 0 });
    console.log(
      '[nest-oversize-ui] params.oversize =',
      JSON.stringify(oversizeTyped.params.oversize),
      '— PASS',
    );

    // ── 8. Assert placed panel grew by exactly +50 ────────────────────────────
    expect(oversizeTyped.sheets.length, 'oversize must produce ≥1 sheet').toBeGreaterThan(0);
    expect(
      oversizeTyped.sheets[0]!.panels.length,
      'oversize sheet must contain ≥1 panel',
    ).toBeGreaterThan(0);

    const oversizePlacedL = oversizeTyped.sheets[0]!.panels[0]!.length;
    const oversizePlacedW = oversizeTyped.sheets[0]!.panels[0]!.width;
    console.log(
      `[nest-oversize-ui] oversize placed: length=${oversizePlacedL} width=${oversizePlacedW}`,
      `(expected: length=${REAL_PANEL_L + 50}, width=${REAL_PANEL_W})`,
    );

    expect(
      oversizePlacedL,
      `placed length must equal ${REAL_PANEL_L} + 50 = ${REAL_PANEL_L + 50}`,
    ).toBe(REAL_PANEL_L + 50);

    expect(
      oversizePlacedW,
      `placed width must equal ${REAL_PANEL_W} (oversize.widthMm=0)`,
    ).toBe(REAL_PANEL_W);

    const delta = oversizePlacedL - baselinePlacedL;
    console.log(
      `[nest-oversize-ui] length delta: baseline=${baselinePlacedL} oversize=${oversizePlacedL} delta=+${delta}`,
    );
    expect(
      delta,
      `placed length must grow by exactly +50mm (real OK handler path)`,
    ).toBe(50);

    // ── 9. Undo and verify revert ─────────────────────────────────────────────
    await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { undo(): Promise<boolean> } } };
      };
      const result = await w.__zilventorStore.getState().bus.undo();
      if (!result) throw new Error('bus.undo() returned false — nothing to undo');
    });

    // After undoing the oversize GenerateNest, nest reverts to baseline state.
    const nestAfterUndo = await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { activeAssembly: { nest?: unknown } | null };
        };
      };
      const nest = w.__zilventorStore.getState().activeAssembly?.nest;
      return nest ? JSON.parse(JSON.stringify(nest)) : null;
    });

    expect(nestAfterUndo, 'after undo, nest must not be null (baseline nest should remain)').not.toBeNull();
    const nestAfterUndoTyped = nestAfterUndo as {
      params: { oversize?: { lengthMm: number; widthMm: number } };
    };
    expect(
      nestAfterUndoTyped.params.oversize,
      'after undo, params.oversize must be absent (reverted to baseline)',
    ).toBeUndefined();
    console.log('[nest-oversize-ui] undo reverted oversize → baseline params — PASS');

    // ── 10. Zero browser errors ───────────────────────────────────────────────
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('favicon'),
    );
    expect(realErrors, 'no browser errors during real-UI nesting-oversize flow').toHaveLength(0);
  },
);
