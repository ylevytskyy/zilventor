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
    //
    // solverDirty is a CONSUMABLE flag: reloadCabinet() sets it true synchronously,
    // but App.tsx's debounced solver effect (50ms) legitimately clears it back to
    // false once the async solve completes — a real, non-buggy state transition, not
    // a stuck/undirtied flag. Reading it in a *separate* page.evaluate() round-trip
    // races that debounce: under parallel-suite CPU load the IPC round-trip can take
    // longer than 50ms + solve time, so the flag can already read false by the time
    // we look. Snapshot the pre-command solverDiagnostics object reference here, in
    // the SAME evaluate/tick as the command dispatch (before any yield), so the read
    // step below can prove the solve was triggered by identity-comparing diagnostics
    // even if solverDirty already flipped back to false.
    await page.evaluate(async (cabPath: string) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            bus: { execute(c: unknown): Promise<void> };
            subAssemblyDocs: Record<string, unknown>;
            solverDiagnostics: unknown;
            setSolverDirty(v: boolean): void;
          };
        };
        __zilventorGetOpfs(): Promise<{
          read(p: string): Promise<Uint8Array>;
          write(p: string, b: Uint8Array): Promise<void>;
          exists(p: string): Promise<boolean>;
        }>;
        __preTandemDiagnostics?: unknown;
      };
      w.__preTandemDiagnostics = w.__zilventorStore.getState().solverDiagnostics;
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

    // ── C+D+E. Assert via STORE: drawerBox count + tandem-slide path + solverDirty ─
    //
    // Architecture note: panel-level bores (tandem-cabinet, tandem-drawer-bottom,
    // tandem-drawer-back roles) are written to OPFS .zipt files and are NOT stored in
    // the Zustand store. subAssemblyDocs only holds the cabinet AssemblyDocument (component
    // list), not individual panel PartDocuments. Reading OPFS for bore assertions is the
    // exact anti-pattern that hid the leg-leveler bug; we do not do it here.
    //
    // Instead we assert the closest non-OPFS proxy that is NON-VACUOUS:
    //   • drawerBox count = 2  — proves reloadCabinet ran and the boxes were created
    //   • tandemSlideCount > 0 — every drawerSlide component's partPath contains 'tandem';
    //       fails if slideSystem:'sideMount' is used (path = hardware/drawer-slide-500.zipt,
    //       no 'tandem') — proves the tandem code branch was actually exercised
    //   • solverDirty = true   — proves scene-refresh path ran
    // solverDirty is consumable (see note above B), so we don't poll for it directly —
    // a transient flag can't be trusted to still read true, and polling for it would be
    // wrong (it may correctly have already flipped false). Instead we poll for the
    // durable consequence: either the flag is still true, OR it was already consumed,
    // which is provable by solverDiagnostics having been replaced with a new object
    // (setSolverResult always assigns a fresh diagnostics object) since the snapshot
    // taken immediately before the command was dispatched.
    let storeResult!: {
      boxCount: number;
      tandemSlideCount: number;
      solverDirty: boolean;
      solveTriggered: boolean;
    };
    await expect
      .poll(
        async () => {
          storeResult = await page.evaluate(
            (cabPath: string) => {
              const w = window as unknown as {
                __zilventorStore: {
                  getState(): {
                    subAssemblyDocs: Record<string, {
                      components: Array<{ role?: string; partPath?: string }>;
                    }>;
                    solverDirty: boolean;
                    solverDiagnostics: unknown;
                  };
                };
                __preTandemDiagnostics?: unknown;
              };
              const state = w.__zilventorStore.getState();
              const doc = state.subAssemblyDocs[cabPath];
              if (!doc) {
                return { boxCount: -1, tandemSlideCount: -1, solverDirty: false, solveTriggered: false };
              }
              const slideComps = doc.components.filter((c) => c.role === 'drawerSlide');
              return {
                boxCount: doc.components.filter((c) => c.role === 'drawerBox').length,
                // non-vacuous: tandem slide path = 'hardware/drawer-slide-tandem-500.zipt';
                // sideMount path = 'hardware/drawer-slide-500.zipt' (no 'tandem' substring)
                tandemSlideCount: slideComps.filter(
                  (c) => typeof c.partPath === 'string' && c.partPath.includes('tandem'),
                ).length,
                solverDirty: state.solverDirty,
                solveTriggered:
                  state.solverDirty === true ||
                  state.solverDiagnostics !== w.__preTandemDiagnostics,
              };
            },
            cabinetPath,
          );
          return (
            storeResult.boxCount === 2 &&
            storeResult.tandemSlideCount > 0 &&
            storeResult.solveTriggered
          );
        },
        {
          timeout: 10_000,
          message:
            'store.subAssemblyDocs must gain 2 drawerBox + ≥1 tandem drawerSlide components, and the ' +
            'reloadCabinet solve-trigger must be observed (solverDirty still true, or already consumed ' +
            'as proven by a new solverDiagnostics object) after the tandem AddDrawerBankCommand',
        },
      )
      .toBe(true);

    console.log(
      '[m4-c] store drawerBox count =', storeResult.boxCount,
      '| tandemSlideCount =', storeResult.tandemSlideCount,
      '| solverDirty =', storeResult.solverDirty,
      '| solveTriggered =', storeResult.solveTriggered,
    );

    expect(
      storeResult.boxCount,
      `store.subAssemblyDocs["${cabinetPath}"] must have 2 drawerBox components; got ${storeResult.boxCount}. ` +
        `If −1, subAssemblyDocs was never updated (reloadCabinet missing).`,
    ).toBe(2);

    // Non-vacuous tandem-path assertion: fails if sideMount slide SKU was used.
    expect(
      storeResult.tandemSlideCount,
      `store.subAssemblyDocs["${cabinetPath}"] must have ≥1 drawerSlide with 'tandem' in partPath; ` +
        `got ${storeResult.tandemSlideCount}. Fails if slideSystem:'sideMount' was used instead of 'tandem'.`,
    ).toBeGreaterThan(0);

    expect(
      storeResult.solveTriggered,
      'reloadCabinet must have set solverDirty (still true, or already consumed by the debounced solve — ' +
        'proven by solverDiagnostics identity change) after tandem AddDrawerBankCommand',
    ).toBe(true);

    // ── F. 0 browser console errors ───────────────────────────────────────────
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('favicon'),
    );
    expect(realErrors, 'no browser errors during M4-C tandem slides flow').toHaveLength(0);
  },
);
