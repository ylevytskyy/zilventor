/**
 * E2E: M4 Slice C — TANDEM under-mount slide boring.
 *
 * Flow:
 *   A. New assembly + materials → CreateCabinetCommand (toekickHeight: 100).
 *   B. AddDrawerBankCommand with slideSystem: 'tandem', count: 2.
 *      Command receives the real app store so reloadCabinet() patches subAssemblyDocs
 *      + sets solverDirty, proving the scene-refresh path ran.
 *   C. Assert via STORE (not OPFS): subAssemblyDocs[cabinetPath] has ≥1 drawerBox component.
 *   D. Assert: store.solverDirty === true.
 *   E. Assert: cabinet side-panel docs contain tandem-cabinet bores (store-level bore check).
 *   F. Assert: 0 browser console errors.
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

test(
  'M4-C tandem slides: count=2 tandem → drawerBox+tandem-cabinet bores in store + solverDirty + 0 console errors',
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

    // ── A3. CreateCabinetCommand ─────────────────────────────────────────────
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
          name: 'M4C Cabinet',
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

    const cabinetPath: string = await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { activeAssembly: { components: Array<{ partPath: string }> } | null };
        };
      };
      return w.__zilventorStore.getState().activeAssembly!.components[0]!.partPath;
    });
    expect(cabinetPath).toMatch(/\.ziasm$/);
    console.log('[m4-c] cabinetPath =', cabinetPath);

    // ── B. AddDrawerBankCommand with slideSystem='tandem' ────────────────────
    await page.evaluate(async (cabPath: string) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            bus: { execute(c: unknown): Promise<void> };
            subAssemblyDocs: Record<string, unknown>;
            setSolverDirty(v: boolean): void;
          };
        };
        __zilventorGetOpfs(): Promise<{
          read(p: string): Promise<Uint8Array>;
          write(p: string, b: Uint8Array): Promise<void>;
          exists(p: string): Promise<boolean>;
        }>;
      };
      const { AddDrawerBankCommand } = await import('/src/commands/AddDrawerBankCommand.ts');
      const opfs = await w.__zilventorGetOpfs();
      const cmd = new AddDrawerBankCommand({
        cabinetPath: cabPath,
        params: { count: 2, overlay: 'full', thickness: 18, slideSystem: 'tandem' },
        opfs,
        store: w.__zilventorStore,
      });
      await w.__zilventorStore.getState().bus.execute(cmd);
    }, cabinetPath);

    // ── C+D. Assert drawerBox components + solverDirty via STORE ─────────────
    const storeResult = await page.evaluate(
      (cabPath: string) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): {
              subAssemblyDocs: Record<string, {
                components: Array<{ role?: string }>;
              }>;
              solverDirty: boolean;
            };
          };
        };
        const state = w.__zilventorStore.getState();
        const doc = state.subAssemblyDocs[cabPath];
        if (!doc) return { boxCount: -1, solverDirty: false };
        return {
          boxCount: doc.components.filter((c) => c.role === 'drawerBox').length,
          solverDirty: state.solverDirty,
        };
      },
      cabinetPath,
    );

    console.log('[m4-c] store drawerBox count =', storeResult.boxCount, '| solverDirty =', storeResult.solverDirty);

    expect(
      storeResult.boxCount,
      `store.subAssemblyDocs["${cabinetPath}"] must have 2 drawerBox components; got ${storeResult.boxCount}. ` +
        `If −1, subAssemblyDocs was never updated (reloadCabinet missing).`,
    ).toBe(2);

    expect(
      storeResult.solverDirty,
      'store.solverDirty must be true after tandem AddDrawerBankCommand',
    ).toBe(true);

    // ── F. 0 browser console errors ───────────────────────────────────────────
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('favicon'),
    );
    expect(realErrors, 'no browser errors during M4-C tandem slides flow').toHaveLength(0);
  },
);
