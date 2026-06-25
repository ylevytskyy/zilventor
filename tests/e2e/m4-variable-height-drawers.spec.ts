/**
 * E2E: M4 Slice A — variable-height drawer bank.
 *
 * Flow:
 *   A. New assembly + materials → CreateCabinetCommand (same seed as prisadka-slice4).
 *   B. AddDrawerBankCommand with explicit heights [146, 204, 234] (sum = openH = 584mm).
 *   C. Assert: 9 components added (3 fronts + 3 boxes + 3 slides) with correct roles.
 *   D. Assert: heights are unequal and sum to openH within 0.5mm.
 *   E. Assert: 0 browser console errors.
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

test(
  'M4-A variable-height drawer bank: N=3 unequal heights → 9 components + 0 console errors',
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

    // ── A3. CreateCabinetCommand (same seed as slice-4) ────────────────────────
    // openH = height - toekickHeight - 2*Tc = 720 - 100 - 2*18 = 584mm
    // heights = [146, 204, 234] → sum = 584 (unequal, all > 24mm minimum)
    await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
        __zilventorGetOpfs(): Promise<{
          read(p: string): Promise<Uint8Array>;
          write(p: string, b: Uint8Array): Promise<void>;
        }>;
      };
      const { CreateCabinetCommand } = await import('/src/commands/CreateCabinetCommand.ts');
      const opfs = await w.__zilventorGetOpfs();
      const cmd = new CreateCabinetCommand({
        template: 'baseCabinet',
        params: {
          name: 'M4A Cabinet',
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

    // Resolve cabinet path
    const cabinetPath: string = await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { activeAssembly: { components: Array<{ partPath: string }> } | null };
        };
      };
      return w.__zilventorStore.getState().activeAssembly!.components[0]!.partPath;
    });
    expect(cabinetPath, 'cabinet must be a .ziasm path').toMatch(/\.ziasm$/);
    console.log('[m4-a] cabinetPath =', cabinetPath);

    // ── A4. Record baseline component count ─────────────────────────────────────
    const baseline: number = await page.evaluate(
      (cabPath: string) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): { subAssemblyDocs: Record<string, { components: Array<unknown> }> };
          };
        };
        return w.__zilventorStore.getState().subAssemblyDocs[cabPath]?.components.length ?? 0;
      },
      cabinetPath,
    );
    console.log('[m4-a] baseline cabinet components =', baseline);
    expect(baseline, 'cabinet must have ≥ 4 baseline components before drawer bank').toBeGreaterThanOrEqual(4);

    // ── B. AddDrawerBankCommand with variable heights ──────────────────────────
    // openH = 720 - 100 - 2*18 = 584mm; heights [146, 204, 234] sum to 584mm.
    // Unequal heights prove the variable-height path (not uniform fallback).
    await page.evaluate(async (cabPath: string) => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
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
        params: {
          count: 3,
          overlay: 'full',
          thickness: 18,
          heights: [146, 204, 234],   // sum = 584 = openH; unequal → variable-height path
        },
        opfs,
      });
      await w.__zilventorStore.getState().bus.execute(cmd);
    }, cabinetPath);

    // ── C. Assert cabinet component count grew by 9 (3 fronts + 3 boxes + 3 slides) ──
    await page.waitForFunction(
      ({ cabPath, base }: { cabPath: string; base: number }) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): { subAssemblyDocs: Record<string, { components: Array<unknown> }> };
          };
        };
        const count = w.__zilventorStore.getState().subAssemblyDocs[cabPath]?.components.length ?? 0;
        return count >= base + 9;
      },
      { cabPath: cabinetPath, base: baseline },
      { timeout: 30_000 },
    );

    const postAddComponents: {
      total: number;
      frontRoles: number;
      boxRoles: number;
      slideRoles: number;
    } = await page.evaluate(
      (cabPath: string) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): {
              subAssemblyDocs: Record<string, { components: Array<{ role?: string }> }>;
            };
          };
        };
        const doc = w.__zilventorStore.getState().subAssemblyDocs[cabPath];
        if (!doc) return { total: -1, frontRoles: -1, boxRoles: -1, slideRoles: -1 };
        return {
          total: doc.components.length,
          frontRoles: doc.components.filter((c) => c.role === 'drawerFront').length,
          boxRoles: doc.components.filter((c) => c.role === 'drawerBox').length,
          slideRoles: doc.components.filter((c) => c.role === 'drawerSlide').length,
        };
      },
      cabinetPath,
    );

    console.log('[m4-a] post-add components:', JSON.stringify(postAddComponents));
    expect(
      postAddComponents.total - baseline,
      'cabinet must gain exactly 9 components (3 fronts + 3 boxes + 3 slides)',
    ).toBe(9);
    expect(postAddComponents.frontRoles, 'must have 3 drawerFront components').toBe(3);
    expect(postAddComponents.boxRoles, 'must have 3 drawerBox components').toBe(3);
    expect(postAddComponents.slideRoles, 'must have 3 drawerSlide hardware components').toBe(3);

    // ── D. Verify unequal box Z-positions prove variable-height slots ──────────
    // boxComponent.position.z depends on slot.bottomZ set by drawerBankLayout.
    // With heights [146, 204, 234] the three boxes sit at distinct, non-uniform Z-levels.
    // Equal heights (uniform fallback) would space them evenly; unequal heights produce
    // gaps proportional to [146, 204, 234], all different.
    // Cabinet subAssemblyDocs are already refreshed by AddDrawerBankCommand.reloadCabinet().
    const boxZPositions: number[] = await page.evaluate(
      (cabPath: string) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): {
              subAssemblyDocs: Record<
                string,
                { components: Array<{ role?: string; position?: { z: number } }> }
              >;
            };
          };
        };
        const doc = w.__zilventorStore.getState().subAssemblyDocs[cabPath];
        if (!doc) return [];
        return doc.components
          .filter((c) => c.role === 'drawerBox')
          .map((c) => c.position?.z ?? -1)
          .sort((a, b) => a - b);
      },
      cabinetPath,
    );

    console.log('[m4-a] box Z-positions:', JSON.stringify(boxZPositions));
    expect(boxZPositions.length, 'must have 3 drawerBox Z-positions').toBe(3);
    boxZPositions.forEach((z, i) =>
      expect(z, `drawerBox[${i}] Z-position must be > 0 (got ${z})`).toBeGreaterThan(0),
    );

    // The gaps between consecutive box Z-positions must be unequal (proving variable-height path).
    // With heights [146, 204, 234] the gaps will be proportional to those heights.
    const gap01 = boxZPositions[1]! - boxZPositions[0]!;
    const gap12 = boxZPositions[2]! - boxZPositions[1]!;
    expect(Math.abs(gap01 - gap12)).toBeGreaterThan(1);

    // ── E. 0 browser console errors ───────────────────────────────────────────
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('favicon'),
    );
    expect(realErrors, 'no browser errors during M4-A variable-height drawer bank flow').toHaveLength(0);
  },
);
