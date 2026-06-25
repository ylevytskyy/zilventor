/**
 * E2E: M4 Slice B — leg levelers.
 *
 * Flow:
 *   A. New assembly + materials → CreateCabinetCommand (toekickHeight: 100).
 *   B. AddLegLevelersCommand with legsPerRow: 2 (2 rows × 2 legs = 4 total).
 *   C. Assert: ≥4 components with role === 'legLeveler' in the cabinet assembly (read from OPFS
 *      via __zilventorUnpackAssembly — AddLegLevelersCommand writes to OPFS directly).
 *   D. Assert: 0 browser console errors.
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

test(
  'M4-B leg levelers: legsPerRow=2 → ≥4 legLeveler components + 0 console errors',
  async ({ page }) => {
    test.setTimeout(360_000);
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

    // ── A1. New assembly ───────────────────────────────────────────────────────
    await page.getByRole('tab', { name: 'File' }).click();
    await page.getByRole('button', { name: /new assembly/i }).click();
    await page.waitForFunction(() => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
      };
      return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
    });

    // ── A2. Register cabinet materials ─────────────────────────────────────────
    await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { addMaterial(m: unknown): void } };
      };
      const add = w.__zilventorStore.getState().addMaterial;
      add({ id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' });
      add({ id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' });
    });

    // ── A3. CreateCabinetCommand with toekickHeight: 100 ─────────────────────
    // deriveCabinetDims reads toekickHeight from bottomComp.position.z,
    // which buildBaseCabinet sets to tkH = 100.
    await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
        __zilventorGetOpfs(): Promise<{
          read(p: string): Promise<Uint8Array>;
          write(p: string, b: Uint8Array): Promise<void>;
          exists(p: string): Promise<boolean>;
        }>;
      };
      const { CreateCabinetCommand } = await import('/src/commands/CreateCabinetCommand.ts');
      const opfs = await w.__zilventorGetOpfs();
      const cmd = new CreateCabinetCommand({
        template: 'baseCabinet',
        params: {
          name: 'M4B Cabinet',
          width: 600,
          depth: 560,
          height: 720,
          toekickHeight: 100,
          toekickSetback: 50,
          shelfCount: 0,
          carcassMaterialId: 'm-birch-18',
          backMaterialId: 'm-hb-6',
          bandMaterialId: null,
        },
        opfs,
      });
      await w.__zilventorStore.getState().bus.execute(cmd);
    });

    // Wait for the outer assembly to have exactly 1 component (the cabinet ref).
    await page.waitForFunction(
      () => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): { activeAssembly: { components: Array<{ partPath: string }> } | null };
          };
        };
        return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) === 1;
      },
      undefined,
      { timeout: 30_000 },
    );

    // Resolve cabinet .ziasm path from the outer assembly component.
    const cabinetPath: string = await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { activeAssembly: { components: Array<{ partPath: string }> } | null };
        };
      };
      return w.__zilventorStore.getState().activeAssembly!.components[0]!.partPath;
    });
    expect(cabinetPath, 'cabinet must be a .ziasm path').toMatch(/\.ziasm$/);
    console.log('[m4-b] cabinetPath =', cabinetPath);

    // ── B. AddLegLevelersCommand: legsPerRow=2 → 4 legs total ────────────────
    // legsPerRow=2 → xs=[50, 550]; ys=[75, 535] → 4 positions (2R).
    // Fit: 2×50 + 36 = 136 < 600 (width OK); 75 + 25 + 36 = 136 < 560 (depth OK).
    await page.evaluate(async (cabPath: string) => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
        __zilventorGetOpfs(): Promise<{
          read(p: string): Promise<Uint8Array>;
          write(p: string, b: Uint8Array): Promise<void>;
          exists(p: string): Promise<boolean>;
        }>;
      };
      const { AddLegLevelersCommand } = await import('/src/commands/AddLegLevelersCommand.ts');
      const opfs = await w.__zilventorGetOpfs();
      const cmd = new AddLegLevelersCommand({
        cabinetPath: cabPath,
        params: { legsPerRow: 2 },
        opfs,
      });
      await w.__zilventorStore.getState().bus.execute(cmd);
    }, cabinetPath);

    // ── C. Assert ≥4 legLeveler components in the cabinet assembly ───────────
    // AddLegLevelersCommand writes directly to OPFS (no store.subAssemblyDocs update).
    // Read back via __zilventorUnpackAssembly (exposed by App.tsx) + __zilventorGetOpfs.
    const legLevelerCount: number = await page.evaluate(async (cabPath: string) => {
      const w = window as unknown as {
        __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
        __zilventorUnpackAssembly(b: Uint8Array): Promise<{ components: Array<{ role?: string }> }>;
      };
      const opfs = await w.__zilventorGetOpfs();
      const bytes = await opfs.read(cabPath);
      const cab = await w.__zilventorUnpackAssembly(bytes);
      return cab.components.filter((c) => c.role === 'legLeveler').length;
    }, cabinetPath);

    console.log('[m4-b] legLeveler count =', legLevelerCount);
    expect(
      legLevelerCount,
      `cabinet must have ≥4 legLeveler components (legsPerRow=2 → 2 rows × 2 = 4 legs); got ${legLevelerCount}`,
    ).toBeGreaterThanOrEqual(4);

    // ── D. 0 browser console errors ───────────────────────────────────────────
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('favicon'),
    );
    expect(realErrors, 'no browser errors during M4-B leg levelers flow').toHaveLength(0);
  },
);
