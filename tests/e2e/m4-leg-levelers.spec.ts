/**
 * E2E: M4 Slice B — leg levelers.
 *
 * Flow:
 *   A. New assembly + materials → CreateCabinetCommand (toekickHeight: 100).
 *   B. AddLegLevelersCommand with legsPerRow: 2 (2 rows × 2 legs = 4 total).
 *      Command receives the real app store so reloadCabinet() patches subAssemblyDocs
 *      + sets solverDirty, proving the scene-refresh path ran.
 *   C. Assert: ≥4 components with role === 'legLeveler' in store.subAssemblyDocs
 *      (NOT from OPFS — this catches regressions where reloadCabinet is removed).
 *   D. Assert: store.getState().solverDirty === true (viewport will re-tessellate).
 *   E. Assert: 0 browser console errors.
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

test(
  'M4-B leg levelers: legsPerRow=2 → ≥4 legLeveler components in store + solverDirty + 0 console errors',
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

    // ── B+C. AddLegLevelersCommand + store read, in ONE page.evaluate ────────
    // Pass the real app store (window.__zilventorStore === useAppStore) so
    // reloadCabinet() patches subAssemblyDocs + sets solverDirty in the live store.
    // legsPerRow=2 → xs=[50,550]; ys=[75,535] → 4 positions.
    // Fit: 2×50+36=136<600 (width OK); 75+25+36=136<560 (depth OK).
    //
    // solverDirty is a CONSUMABLE flag: App.tsx's solver effect debounces 50ms
    // after solverDirty flips true, then calls setSolverResult(...) which resets
    // it to false. Reading it via a SEPARATE page.evaluate() call after execute()
    // adds a real CDP round-trip whose duration is not bounded by 50ms under
    // parallel-suite load, so it can race past the debounce and observe an
    // already-cleared flag (flaky failure reproduced: solverDirty read as false).
    // Reading state here, in the SAME evaluate right after the awaited command
    // resolves, keeps the read in the same microtask chain as the synchronous
    // setSolverDirty(true) inside reloadCabinet() — provably ordered before any
    // macrotask-scheduled React effect/timer can consume it.
    const storeResult = await page.evaluate(async (cabPath: string) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            bus: { execute(c: unknown): Promise<void> };
            subAssemblyDocs: Record<string, { components: Array<{ role?: string }> }>;
            solverDirty: boolean;
          };
        };
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
        store: w.__zilventorStore, // real app store → reloadCabinet patches subAssemblyDocs
      });
      await w.__zilventorStore.getState().bus.execute(cmd);

      // ── C. Read ≥4 legLeveler components + solverDirty via the STORE (not OPFS) ──
      // This proves reloadCabinet() ran: if it were removed, subAssemblyDocs[cabPath]
      // would not contain the leg components even though they are in OPFS.
      const state = w.__zilventorStore.getState();
      const doc = state.subAssemblyDocs[cabPath];
      if (!doc) return { legCount: -1, solverDirty: false };
      return {
        legCount: doc.components.filter((c) => c.role === 'legLeveler').length,
        solverDirty: state.solverDirty,
      };
    }, cabinetPath);

    console.log('[m4-b] store legLeveler count =', storeResult.legCount, '| solverDirty =', storeResult.solverDirty);

    expect(
      storeResult.legCount,
      `store.subAssemblyDocs["${cabinetPath}"] must have ≥4 legLeveler components ` +
        `(legsPerRow=2 → 2 rows × 2 = 4 legs); got ${storeResult.legCount}. ` +
        `If −1, subAssemblyDocs was never updated (reloadCabinet missing/not called).`,
    ).toBeGreaterThanOrEqual(4);

    // ── D. Assert solverDirty — viewport will re-tessellate legs ─────────────
    expect(
      storeResult.solverDirty,
      'store.solverDirty must be true after AddLegLevelersCommand (proves viewport refresh is triggered)',
    ).toBe(true);

    // ── E. 0 browser console errors ───────────────────────────────────────────
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('favicon'),
    );
    expect(realErrors, 'no browser errors during M4-B leg levelers flow').toHaveLength(0);
  },
);
